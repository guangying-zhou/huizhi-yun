-- READ ONLY CANDIDATE. Run only in reviewed owning Finance unified database.
SELECT table_name FROM information_schema.tables
WHERE table_schema=DATABASE() AND table_name IN
('finance_project_cost_period','finance_project_cost_batch','finance_project_cost_batch_item',
 'finance_employee_cost_snapshot','finance_project_cost_allocation','finance_project_summary')
ORDER BY table_name;
-- Must return six physical BASE TABLEs; installer Verify checks exact DDL/mapping.
SELECT table_name,table_type FROM information_schema.tables
WHERE table_schema=DATABASE() AND table_name LIKE 'finance_project_cost%';
SELECT table_name,column_name,data_type,is_nullable FROM information_schema.columns
WHERE table_schema=DATABASE() AND table_name IN
('finance_project_cost_period','finance_project_cost_batch','finance_project_cost_batch_item',
 'finance_employee_cost_snapshot','finance_project_cost_allocation','finance_project_summary')
ORDER BY table_name,ordinal_position;
