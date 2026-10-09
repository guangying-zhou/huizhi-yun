-- G0+G1 only. Apply to the Console schema; hzy0 installation requires approval.
CREATE TABLE IF NOT EXISTS `console_feedback_settings` (
 `tenant_code` VARCHAR(64) COLLATE utf8mb4_bin NOT NULL PRIMARY KEY,
 `revision` BIGINT NOT NULL,
 `settings_json` JSON NOT NULL,
 `updated_at` DATETIME(3) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS `console_feedback` (
 `tenant_code` VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
 `feedback_id` VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
 `reporter_uid` VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,
 `reporter_name` VARCHAR(255) NOT NULL,
 `text_json` JSON NOT NULL,
 `settings_json` JSON NOT NULL,
 `status` VARCHAR(24) NOT NULL,
 `issue_iid` BIGINT NOT NULL DEFAULT 0,
 `issue_url` VARCHAR(2048) NOT NULL DEFAULT '',
 `generation` BIGINT NOT NULL DEFAULT 0,
 `attempt` BIGINT NOT NULL DEFAULT 0,
 `lease_until` DATETIME(3) NULL,
 `next_attempt_at` DATETIME(3) NOT NULL,
 `created_at` DATETIME(3) NOT NULL,
 `updated_at` DATETIME(3) NOT NULL,
 PRIMARY KEY(tenant_code,feedback_id),
 KEY `idx_feedback_owner`(tenant_code,reporter_uid,created_at),
 KEY `idx_feedback_pending`(tenant_code,status,next_attempt_at),
 CONSTRAINT `ck_feedback_status` CHECK (status IN ('draft','pending','dispatching','submitted','failed','unknown','cancelled'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS `console_feedback_events` (
 `tenant_code` VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
 `event_id` VARCHAR(100) COLLATE utf8mb4_bin NOT NULL,
 `feedback_id` VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
 `event_type` VARCHAR(24) NOT NULL,
 `recipient_policy_json` JSON NOT NULL,
 `recipient_uids_json` JSON NULL,
 `resolve_after` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 `created_at` DATETIME(3) NOT NULL,
 PRIMARY KEY(tenant_code,event_id),
 KEY `idx_feedback_event`(tenant_code,feedback_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS `console_feedback_delivery` (
 `tenant_code` VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
 `event_id` VARCHAR(100) COLLATE utf8mb4_bin NOT NULL,
 `recipient_uid` VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,
 `channel` VARCHAR(16) NOT NULL,
 `status` VARCHAR(16) NOT NULL DEFAULT 'pending',
 `attempt` BIGINT NOT NULL DEFAULT 0,
 `lease_until` DATETIME(3) NULL,
 `updated_at` DATETIME(3) NOT NULL,
 PRIMARY KEY(tenant_code,event_id,recipient_uid,channel),
 KEY `idx_feedback_delivery`(tenant_code,status,lease_until),
 CONSTRAINT `ck_feedback_channel` CHECK (channel IN ('in_app','wecom')),
 CONSTRAINT `ck_feedback_delivery_status` CHECK (status IN ('pending','sending','sent','skipped'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
