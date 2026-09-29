-- Workflow notification, actionable lifecycle and callback delivery recovery.
-- Apply only after 012; DDL is not transactional. Back up and verify before use.
-- Existing rows retain status/attempts/keys. Historical dependencies are NULL
-- and require read-only inventory plus a reviewed disposition, never inference.

ALTER TABLE flow_notification_outbox
  MODIFY COLUMN delivery_status ENUM('pending','delivered','abandoned') NOT NULL DEFAULT 'pending',
  ADD COLUMN version_no BIGINT UNSIGNED NOT NULL DEFAULT 1 AFTER attempt_count,
  ADD COLUMN abandoned_at DATETIME NULL AFTER delivered_at,
  ADD COLUMN last_error_code VARCHAR(100) NULL AFTER abandoned_at,
  ADD COLUMN last_http_status SMALLINT UNSIGNED NULL AFTER last_error_code;

ALTER TABLE flow_actionable_outbox
  MODIFY COLUMN delivery_status ENUM('pending','delivered','abandoned') NOT NULL DEFAULT 'pending',
  ADD COLUMN depends_on_notification_outbox_id BIGINT UNSIGNED NULL AFTER prerequisite_notifications,
  ADD COLUMN version_no BIGINT UNSIGNED NOT NULL DEFAULT 1 AFTER attempt_count,
  ADD COLUMN abandoned_at DATETIME NULL AFTER delivered_at,
  ADD COLUMN last_error_code VARCHAR(100) NULL AFTER abandoned_at,
  ADD COLUMN last_http_status SMALLINT UNSIGNED NULL AFTER last_error_code,
  ADD INDEX idx_actionable_notification_dependency (depends_on_notification_outbox_id);

-- No FK on the dependency: both outboxes currently cascade with flow_instances.
-- A new cross-outbox FK would change that existing deletion contract. Runtime
-- validates the referenced row's tenant-local identity and delivered status.
ALTER TABLE flow_callback_logs
  MODIFY COLUMN status ENUM('success','failed','pending','abandoned') NOT NULL DEFAULT 'pending' COMMENT '回调状态',
  ADD COLUMN version_no BIGINT UNSIGNED NOT NULL DEFAULT 1 AFTER attempts,
  ADD COLUMN abandoned_at DATETIME NULL AFTER next_attempt_at,
  ADD COLUMN last_error_code VARCHAR(100) NULL AFTER abandoned_at,
  ADD COLUMN last_http_status SMALLINT UNSIGNED NULL AFTER last_error_code;

CREATE TABLE flow_delivery_audit (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  delivery_kind ENUM('notification','actionable','callback') NOT NULL,
  effect_id BIGINT UNSIGNED NOT NULL,
  event_code VARCHAR(64) NOT NULL,
  prior_status VARCHAR(32) NOT NULL,
  next_status VARCHAR(32) NOT NULL,
  prior_version_no BIGINT UNSIGNED NOT NULL,
  next_version_no BIGINT UNSIGNED NOT NULL,
  attempt_count INT UNSIGNED NOT NULL,
  actor_code VARCHAR(191) NOT NULL,
  reason_code VARCHAR(100) NOT NULL,
  tenant_code VARCHAR(100) NOT NULL,
  deployment_code VARCHAR(100) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_flow_delivery_audit_effect (delivery_kind, effect_id, id),
  KEY idx_flow_delivery_audit_tenant (tenant_code, delivery_kind, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Workflow 投递状态转换和受控恢复审计（不存正文、令牌或异常文本）';
