-- Candidate only; run against the selected tenant schema, never automatically.
SELECT table_name FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name IN ('finance_expense','finance_expense_claim','finance_expense_claim_item','finance_project_expense_request','finance_project_expense_request_item');
SELECT index_name,column_name FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='finance_expense' AND index_name='uk_finance_expense_source' ORDER BY seq_in_index;
