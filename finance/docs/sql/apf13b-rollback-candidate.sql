-- Candidate only. Installer receipt rollback refuses nonempty tables.
-- Do not drop if any payment requests exist; preserve receipts and audit.
SELECT COUNT(*) AS must_be_zero FROM finance_payment_request;
-- Use ForFinance13b.Rollback with verified installation receipt; no blind DROP.
