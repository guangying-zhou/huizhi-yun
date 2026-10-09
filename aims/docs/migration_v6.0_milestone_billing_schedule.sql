-- Candidate only. Runtime must be stopped under an approved migration window.
-- Do not backfill numeric payment_term_id without authoritative Altoc mapping.
ALTER TABLE aims_milestones
  ADD COLUMN billing_schedule_code VARCHAR(64) NULL COMMENT 'Altoc统一结算计划稳定编码（D-06）',
  ADD INDEX idx_milestone_billing_schedule (billing_schedule_code);

-- MySQL freezes SELECT * view columns at creation. Refresh the managed alias.
CREATE OR REPLACE ALGORITHM=MERGE SQL SECURITY INVOKER VIEW milestones AS SELECT * FROM aims_milestones;
