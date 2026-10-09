-- Add a generation fence and an immutable signed artifact to the existing approval table.
-- DDL is nontransactional: back up, check duplicate generations, and stop on any error.
ALTER TABLE enterprise_external_drain_approvals
  ADD COLUMN target_generation VARCHAR(20) NULL,
  ADD COLUMN artifact_json JSON NULL;
UPDATE enterprise_external_drain_approvals
  SET target_generation = JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.generation'));
-- Existing rows have no stored signature. They remain audit-only and cannot be replayed.
ALTER TABLE enterprise_external_drain_approvals
  MODIFY COLUMN target_generation VARCHAR(20) NOT NULL,
  ADD UNIQUE KEY uk_external_drain_generation(tenant_code,environment,cutover_key,target_generation);
