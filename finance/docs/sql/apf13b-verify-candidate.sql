-- Candidate only; read-only after reviewed installation.
SHOW CREATE TABLE finance_payment_request;
SELECT COUNT(*) AS legacy_table_must_not_be_mapping FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='payment_request';
