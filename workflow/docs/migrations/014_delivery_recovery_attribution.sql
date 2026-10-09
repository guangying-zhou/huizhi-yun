-- Add operator-attribution facts without changing existing delivery audit rows.
ALTER TABLE flow_delivery_audit
  ADD COLUMN credential_id BIGINT UNSIGNED NULL AFTER deployment_code,
  ADD COLUMN request_id VARCHAR(191) NULL AFTER credential_id,
  ADD COLUMN recovery_reason VARCHAR(200) NULL AFTER request_id;
