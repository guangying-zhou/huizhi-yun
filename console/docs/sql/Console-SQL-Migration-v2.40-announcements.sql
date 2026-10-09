-- CANDIDATE: approval required before production execution. Console-owned schema.
-- Additive, no automatic startup DDL. Requires existing Console receipts/audit/directory.
CREATE TABLE IF NOT EXISTS `console_announcements` (
  `tenant_code` VARCHAR(64) NOT NULL,
  `announcement_id` VARCHAR(36) NOT NULL,
  `title` VARCHAR(160) NOT NULL,
  `body_markdown` MEDIUMTEXT NOT NULL,
  `level` VARCHAR(16) NOT NULL,
  `starts_at` DATETIME(3) NOT NULL,
  `ends_at` DATETIME(3) NULL,
  `audience` VARCHAR(16) NOT NULL,
  `show_popup` BOOLEAN NOT NULL DEFAULT FALSE,
  `show_banner` BOOLEAN NOT NULL DEFAULT TRUE,
  `push_bell` BOOLEAN NOT NULL DEFAULT FALSE,
  `push_wecom` BOOLEAN NOT NULL DEFAULT FALSE,
  `delivery_prepared` BOOLEAN NOT NULL DEFAULT FALSE,
  `status` VARCHAR(16) NOT NULL DEFAULT 'published',
  `revision` BIGINT UNSIGNED NOT NULL DEFAULT 1,
  `created_by` VARCHAR(128) NOT NULL,
  `updated_by` VARCHAR(128) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_code, announcement_id),
  KEY `idx_announcement_due` (tenant_code,status,starts_at),
  CONSTRAINT `chk_announcement_level` CHECK (level IN ('info','warning')),
  CONSTRAINT `chk_announcement_audience` CHECK (audience IN ('all','departments')),
  CONSTRAINT `chk_announcement_status` CHECK (status IN ('published','withdrawn')),
  CONSTRAINT `chk_announcement_dates` CHECK (ends_at IS NULL OR ends_at > starts_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS `console_announcement_departments` (
  `tenant_code` VARCHAR(64) NOT NULL,
  `announcement_id` VARCHAR(36) NOT NULL,
  `dept_code` VARCHAR(64) NOT NULL,
  PRIMARY KEY (tenant_code,announcement_id,dept_code),
  FOREIGN KEY (tenant_code,announcement_id) REFERENCES console_announcements(tenant_code,announcement_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS `console_announcement_reads` (
  `tenant_code` VARCHAR(64) NOT NULL,
  `announcement_id` VARCHAR(36) NOT NULL,
  `uid` VARCHAR(128) NOT NULL,
  `read_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_code,announcement_id,uid),
  FOREIGN KEY (tenant_code,announcement_id) REFERENCES console_announcements(tenant_code,announcement_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS `console_announcement_outbox` (
  `tenant_code` VARCHAR(64) NOT NULL,
  `announcement_id` VARCHAR(36) NOT NULL,
  `revision` BIGINT UNSIGNED NOT NULL,
  `uid` VARCHAR(128) NOT NULL,
  `channel` VARCHAR(16) NOT NULL,
  `state` VARCHAR(16) NOT NULL DEFAULT 'pending',
  `attempts` INT UNSIGNED NOT NULL DEFAULT 0,
  `lease_token` VARCHAR(36) NULL,
  `lease_until` DATETIME(3) NULL,
  `next_attempt_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `delivered_at` DATETIME(3) NULL,
  PRIMARY KEY (tenant_code,announcement_id,revision,uid,channel),
  KEY `idx_announcement_outbox_due` (tenant_code,state,next_attempt_at),
  FOREIGN KEY (tenant_code,announcement_id) REFERENCES console_announcements(tenant_code,announcement_id),
  CONSTRAINT `chk_announcement_channel` CHECK (channel IN ('in_app','wecom')),
  CONSTRAINT `chk_announcement_delivery` CHECK (state IN ('pending','delivered','cancelled'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
