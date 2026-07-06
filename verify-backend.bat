@echo off
echo ===================================================
echo NEXUS BACKEND - Deployment Verification
echo ===================================================
echo.
echo [1] Checking for latest taxonomy marker (Foreign Exchange Gain)...
findstr /C:"Foreign Exchange Gain" src\lib\categoryTaxonomy.js
if %errorlevel% neq 0 (
    echo    FAIL - marker not found. This file is NOT current.
) else (
    echo    OK - marker found.
)
echo.
echo [2] Checking for generic multi-layout parser...
if exist src\parsers\generic.js (
    echo    OK - generic.js exists.
) else (
    echo    FAIL - generic.js missing.
)
echo.
echo [3] Git status...
git status
echo.
echo [4] Last 3 commits...
git log --oneline -3
echo.
echo ===================================================
echo If any FAIL appeared above, do NOT assume this is deployed.
echo Re-copy the delivered zip fully before re-running this script.
echo ===================================================
pause
