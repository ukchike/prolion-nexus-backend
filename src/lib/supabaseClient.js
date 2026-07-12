/**
 * Supabase Client Wrapper
 * Handles all database operations for NEXUS
 */

const https = require('https');

class SupabaseClient {
  constructor(projectId, anonKey) {
    this.projectId = projectId;
    this.anonKey = anonKey;
    this.baseUrl = `https://${projectId}.supabase.co`;
  }

  /**
   * Make HTTP request to Supabase REST API
   */
  async request(method, path, body = null, userToken = null) {
    return new Promise((resolve, reject) => {
      const url = new URL(`${this.baseUrl}/rest/v1${path}`);
      const headers = {
        'Content-Type': 'application/json',
        apikey: this.anonKey,
        Prefer: 'return=representation',
      };

      if (userToken) {
        headers.Authorization = `Bearer ${userToken}`;
      }

      const options = {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method,
        headers,
      };

      const req = https.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          if (res.statusCode >= 400) {
            reject(new Error(`Supabase API error ${res.statusCode}: ${data}`));
          } else {
            try {
              resolve(JSON.parse(data || '[]'));
            } catch {
              resolve(data);
            }
          }
        });
      });

      req.on('error', reject);

      if (body) {
        req.write(JSON.stringify(body));
      }

      req.end();
    });
  }

  /**
   * Insert manual transaction
   */
  async insertTransaction(userId, transaction, userToken) {
    const payload = {
      user_id: userId,
      statement_id: null,
      transaction_date: transaction.date,
      description: transaction.narration,
      raw_narration: transaction.narration,
      debit: transaction.type === 'expense' ? transaction.amount : null,
      credit: transaction.type === 'income' ? transaction.amount : null,
      balance: null,
      ai_category: null,
      user_category: transaction.category,
      category_group: this.mapCategoryToGroup(transaction.category),
      source: 'manual',
      is_vat_inclusive: transaction.is_vat_inclusive,
      vat_amount: transaction.vat_amount || 0,
      net_amount: transaction.net_amount || transaction.amount,
      is_verified: true,
    };

    return this.request(
      'POST',
      '/transactions',
      payload,
      userToken,
    );
  }

  /**
   * Update transaction VAT status
   */
  async updateTransactionVAT(transactionId, vatData, userToken) {
    const payload = {
      is_vat_inclusive: vatData.is_vat_inclusive,
      vat_amount: vatData.vat_amount,
      net_amount: vatData.net_amount,
    };

    return this.request(
      'PATCH',
      `/transactions?id=eq.${transactionId}`,
      payload,
      userToken,
    );
  }

  /**
   * Get aggregated dashboard metrics
   */
  async getDashboardMetrics(userId, startDate, endDate, userToken) {
    // This would be better as a database view or stored procedure
    // For now, fetch all user transactions and aggregate in code
    const query = new URLSearchParams({
      user_id: `eq.${userId}`,
      select: '*',
    });

    if (startDate) {
      query.append('transaction_date', `gte.${startDate}`);
    }
    if (endDate) {
      query.append('transaction_date', `lte.${endDate}`);
    }

    const transactions = await this.request(
      'GET',
      `/transactions?${query.toString()}`,
      null,
      userToken,
    );

    return this.aggregateMetrics(transactions);
  }

  /**
   * Aggregate transaction metrics
   */
  aggregateMetrics(transactions) {
    const metrics = {
      totalIncome: 0,
      totalExpenses: 0,
      totalCashTransactions: 0,
      totalBankTransactions: 0,
      vatCollected: 0,
      vatPaid: 0,
      transactionCount: transactions.length,
    };

    transactions.forEach((txn) => {
      const amount = parseFloat(txn.net_amount || txn.credit || txn.debit || 0);
      const vatAmount = parseFloat(txn.vat_amount || 0);

      // Count by source
      if (txn.source === 'manual') {
        metrics.totalCashTransactions += 1;
      } else {
        metrics.totalBankTransactions += 1;
      }

      // Income metrics
      if (txn.credit && txn.category_group === 'INCOME') {
        metrics.totalIncome += amount;
        if (txn.is_vat_inclusive) {
          metrics.vatCollected += vatAmount;
        }
      }

      // Expense metrics
      if (txn.debit && txn.category_group === 'EXPENSE') {
        metrics.totalExpenses += amount;
        if (txn.is_vat_inclusive) {
          metrics.vatPaid += vatAmount;
        }
      }
    });

    metrics.netVATLiability = metrics.vatCollected - metrics.vatPaid;
    metrics.totalIncome = parseFloat(metrics.totalIncome.toFixed(2));
    metrics.totalExpenses = parseFloat(metrics.totalExpenses.toFixed(2));
    metrics.vatCollected = parseFloat(metrics.vatCollected.toFixed(2));
    metrics.vatPaid = parseFloat(metrics.vatPaid.toFixed(2));
    metrics.netVATLiability = parseFloat(metrics.netVATLiability.toFixed(2));

    return metrics;
  }

  /**
   * Insert opening balances
   */
  async insertOpeningBalances(userId, balances, userToken) {
    const payload = {
      user_id: userId,
      start_date: balances.start_date || null,
      cash_at_bank: balances.assets?.cash_at_bank || 0,
      fixed_assets: balances.assets?.fixed_assets || 0,
      inventory: balances.assets?.inventory || 0,
      other_assets: balances.assets?.other_assets || 0,
      bank_loans: balances.liabilities?.bank_loans || 0,
      other_payables: balances.liabilities?.other_payables || 0,
      retained_earnings: balances.equity?.retained_earnings || 0,
      owner_capital: balances.equity?.owner_capital || 0,
    };

    return this.request(
      'POST',
      '/opening_balances',
      payload,
      userToken,
    );
  }

  /**
   * Map category name to category_group
   */
  mapCategoryToGroup(category) {
    const incomeCategories = ['Sales Revenue', 'Service Income', 'Investment Income', 'Other Income'];
    const expenseCategories = [
      'Cost of Goods Sold', 'Materials & Supplies', 'Direct Labour', 'Manufacturing Overhead',
      'Salaries & Wages', 'Rent & Utilities', 'Office Supplies', 'Transportation',
      'Meals & Entertainment', 'Advertising & Marketing', 'Professional Services', 'Insurance',
      'Repairs & Maintenance', 'Depreciation', 'Phone & Internet', 'Travel',
      'Training & Development', 'Subscriptions & Software', 'Bank Charges & Fees', 'Interest Expense',
      'Donations & CSR', 'Fines & Penalties', 'Miscellaneous Expense', 'Owner Drawings',
    ];
    const balanceSheetCategories = [
      'Cash at Bank', 'Cash on Hand', 'Accounts Receivable', 'Inventory', 'Prepaid Expenses',
      'Fixed Assets', 'Accumulated Depreciation', 'Intangible Assets', 'Accounts Payable',
      'Tax Payable', 'Loans Payable', 'Accrued Expenses', 'Owner Equity', 'Retained Earnings',
      'Capital Contribution', 'Loans Receivable',
    ];

    if (incomeCategories.includes(category)) return 'INCOME';
    if (expenseCategories.includes(category)) return 'EXPENSE';
    if (balanceSheetCategories.includes(category)) return 'BALANCE_SHEET';
    if (category === 'Transfer') return 'TRANSFER';
    return 'UNCLASSIFIED';
  }
}

module.exports = SupabaseClient;
