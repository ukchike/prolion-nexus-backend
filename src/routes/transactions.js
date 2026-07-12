/**
 * Transaction Routes
 * Handles manual transactions, VAT toggles, and dashboard aggregation
 */

const express = require('express');
const {
  ManualTransactionSchema,
  VATToggleSchema,
  DashboardQuerySchema,
  validateInput,
} = require('../lib/validationSchemas');
const { cleanNarration } = require('../lib/narrationCleaner');
const { splitVATInclusive } = require('../lib/vatCalculator');
const SupabaseClient = require('../lib/supabaseClient');

const router = express.Router();

// Initialize Supabase client
const supabase = new SupabaseClient(
  process.env.SUPABASE_PROJECT_ID,
  process.env.SUPABASE_ANON_KEY,
);

/**
 * POST /api/transactions/manual
 * Create a manual (non-bank) transaction with VAT support
 */
router.post('/manual', async (req, res) => {
  try {
    const { authorization } = req.headers;
    if (!authorization) {
      return res.status(401).json({ error: 'Authorization required' });
    }

    // Extract user token
    const userToken = authorization.startsWith('Bearer ')
      ? authorization.slice(7)
      : authorization;

    // Validate input
    const validation = validateInput(ManualTransactionSchema, req.body);
    if (!validation.success) {
      return res.status(400).json({ error: validation.error });
    }

    const input = validation.data;

    // Clean narration for AI (preserve original)
    const cleanedNarration = cleanNarration(input.narration);

    // Calculate VAT if inclusive
    let vatAmount = 0;
    let netAmount = input.amount;

    if (input.is_vat_inclusive) {
      const split = splitVATInclusive(input.amount);
      vatAmount = split.vatAmount;
      netAmount = split.netAmount;
    }

    // Prepare transaction object
    const transaction = {
      date: input.date,
      narration: cleanedNarration,
      amount: input.amount,
      type: input.type,
      category: input.category,
      is_vat_inclusive: input.is_vat_inclusive,
      vat_amount: vatAmount,
      net_amount: netAmount,
    };

    // Insert into Supabase
    const [inserted] = await supabase.insertTransaction(userToken.substring(0, 36), transaction, userToken);

    if (!inserted) {
      return res.status(500).json({ error: 'Failed to save transaction' });
    }

    // Return created transaction with metadata
    return res.status(201).json({
      id: inserted.id,
      source: 'manual',
      ...inserted,
      message: 'Transaction created successfully',
    });
  } catch (error) {
    console.error('Error creating manual transaction:', error.message);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/transactions/:id/vat-toggle
 * Toggle VAT status on existing transaction and recalculate amounts
 */
router.put('/:id/vat-toggle', async (req, res) => {
  try {
    const { authorization } = req.headers;
    if (!authorization) {
      return res.status(401).json({ error: 'Authorization required' });
    }

    const userToken = authorization.startsWith('Bearer ')
      ? authorization.slice(7)
      : authorization;

    const { id } = req.params;

    // Validate input
    const validation = validateInput(VATToggleSchema, req.body);
    if (!validation.success) {
      return res.status(400).json({ error: validation.error });
    }

    const { is_vat_inclusive } = validation.data;

    // Fetch current transaction (in production, also verify user ownership)
    // For now, assuming userToken has read permission
    const transaction = await supabase.request(
      'GET',
      `/transactions?id=eq.${id}`,
      null,
      userToken,
    );

    if (!transaction || transaction.length === 0) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    const current = transaction[0];
    const grossAmount = parseFloat(current.credit || current.debit || 0);

    // Calculate new VAT amounts
    let vatAmount = 0;
    let netAmount = grossAmount;

    if (is_vat_inclusive && !current.is_vat_inclusive) {
      // Converting to VAT-inclusive: need to split the amount
      const split = splitVATInclusive(grossAmount);
      vatAmount = split.vatAmount;
      netAmount = split.netAmount;
    } else if (!is_vat_inclusive && current.is_vat_inclusive) {
      // Converting from VAT-inclusive to non-inclusive: keep gross as-is
      vatAmount = 0;
      netAmount = grossAmount;
    }

    // Update in database
    const updated = await supabase.updateTransactionVAT(id, {
      is_vat_inclusive,
      vat_amount: vatAmount,
      net_amount: netAmount,
    }, userToken);

    if (!updated || updated.length === 0) {
      return res.status(500).json({ error: 'Failed to update transaction' });
    }

    return res.json({
      id,
      is_vat_inclusive,
      vat_amount: vatAmount,
      net_amount: netAmount,
      gross_amount: grossAmount,
      message: 'VAT status toggled successfully',
    });
  } catch (error) {
    console.error('Error toggling VAT:', error.message);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/dashboard/aggregated
 * Get unified dashboard metrics (bank + manual transactions)
 */
router.get('/dashboard/aggregated', async (req, res) => {
  try {
    const { authorization } = req.headers;
    if (!authorization) {
      return res.status(401).json({ error: 'Authorization required' });
    }

    const userToken = authorization.startsWith('Bearer ')
      ? authorization.slice(7)
      : authorization;

    // Validate query parameters
    const validation = validateInput(DashboardQuerySchema, req.query);
    if (!validation.success) {
      return res.status(400).json({ error: validation.error });
    }

    const { start_date, end_date } = validation.data;

    // Extract user ID from token (in production, use proper JWT decoding)
    // For now, use placeholder
    const userId = 'user-id-from-token';

    // Get metrics
    const metrics = await supabase.getDashboardMetrics(
      userId,
      start_date,
      end_date,
      userToken,
    );

    return res.json({
      ...metrics,
      timestamp: new Date().toISOString(),
      notice: 'Dashboard metrics use net amounts for VAT-inclusive transactions to ensure tax computation accuracy.',
    });
  } catch (error) {
    console.error('Error fetching dashboard metrics:', error.message);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/opening-balances
 * Save opening balances for a business
 */
router.post('/opening-balances', async (req, res) => {
  try {
    const { authorization } = req.headers;
    if (!authorization) {
      return res.status(401).json({ error: 'Authorization required' });
    }

    const userToken = authorization.startsWith('Bearer ')
      ? authorization.slice(7)
      : authorization;

    // Validate input
    const { OpeningBalancesSchema } = require('../lib/validationSchemas');
    const validation = validateInput(OpeningBalancesSchema, req.body);
    if (!validation.success) {
      return res.status(400).json({ error: validation.error });
    }

    const balances = validation.data;

    // Extract user ID (in production, use proper JWT)
    const userId = 'user-id-from-token';

    // Insert opening balances
    const [inserted] = await supabase.insertOpeningBalances(userId, balances, userToken);

    if (!inserted) {
      return res.status(500).json({ error: 'Failed to save opening balances' });
    }

    return res.status(201).json({
      id: inserted.id,
      ...inserted,
      message: 'Opening balances saved successfully',
    });
  } catch (error) {
    console.error('Error saving opening balances:', error.message);
    return res.status(500).json({ error: error.message });
  }
});

module.exports = router;
