-- Repeatable Console -> Tenant Runtime cutover schema migration.
--
-- Target manifest:
-- sha256:4a6009caf824db4d2dbd268468e5a04671f85f703100b4f09443fac4056ba0fa
--
-- This migration is additive and deliberately does not rewrite tenant data.
-- Run it only after the approved backup/restore rehearsal. Any invalid legacy
-- row that prevents a CHECK or foreign-key constraint from being installed
-- must stop the migration and be handled through an approved data repair.

SET @console_cutover_schema := DATABASE();

-- Console Runtime mutation receipts.
CREATE TABLE IF NOT EXISTS `console_mutation_receipts` (
  `receipt_id` CHAR(36) NOT NULL,
  `tenant_code` VARCHAR(64) NOT NULL,
  `operation_code` VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `idempotency_key` VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `request_sha256` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `status` VARCHAR(32) NOT NULL,
  `actor_type` VARCHAR(32) NOT NULL,
  `actor_id` VARCHAR(128) NULL,
  `request_id` VARCHAR(64) NULL,
  `response_http_status` SMALLINT UNSIGNED NULL,
  `result_json` JSON NULL,
  `completed_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`receipt_id`),
  UNIQUE KEY `uk_console_mutation_receipt_identity`
    (`tenant_code`, `operation_code`, `idempotency_key`),
  KEY `idx_console_mutation_receipt_status_time` (`status`, `updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Append-only, source-fingerprint-bound disposition evidence for reviewed
-- historical blockers. A changed source row no longer matches and therefore
-- becomes a blocker again.
CREATE TABLE IF NOT EXISTS `console_cutover_dispositions` (
  `disposition_id` CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `category` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `subject_key` VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `source_fingerprint` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `source_updated_at` DATETIME(3) NOT NULL,
  `reason_code` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `reason_text` VARCHAR(500) NOT NULL,
  `change_reference` VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `status` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'active',
  `actor_type` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `actor_id` VARCHAR(128) NULL,
  `source_app` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `request_id` VARCHAR(64) NULL,
  `superseded_by_id` CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `superseded_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `active_subject_key` VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin
    GENERATED ALWAYS AS (
      CASE WHEN `status` = 'active' THEN `subject_key` ELSE NULL END
    ) STORED,
  PRIMARY KEY (`disposition_id`),
  UNIQUE KEY `uk_console_cutover_disposition_active`
    (`category`, `active_subject_key`),
  KEY `idx_console_cutover_disposition_source`
    (`category`, `subject_key`, `source_fingerprint`),
  KEY `idx_console_cutover_disposition_change`
    (`change_reference`, `created_at`),
  CONSTRAINT `ck_console_cutover_disposition_category`
    CHECK (`category` IN (
      'failed_integration_operations',
      'failed_notification_deliveries',
      'incomplete_directory_sync_jobs'
    )),
  CONSTRAINT `ck_console_cutover_disposition_reason`
    CHECK (`reason_code` IN (
      'historical-terminal',
      'legacy-abandoned',
      'superseded'
    )),
  CONSTRAINT `ck_console_cutover_disposition_status`
    CHECK (`status` IN ('active', 'superseded', 'revoked')),
  CONSTRAINT `ck_console_cutover_disposition_fingerprint`
    CHECK (`source_fingerprint` REGEXP '^[0-9a-f]{64}$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Monotonic People lifecycle watermark.
CREATE TABLE IF NOT EXISTS `directory_lifecycle_scope_versions` (
  `employee_uid` VARCHAR(64) NOT NULL,
  `applied_revision` BIGINT UNSIGNED NOT NULL,
  `snapshot_hash` CHAR(64) NOT NULL,
  `lifecycle_type` VARCHAR(32) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`employee_uid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Console-owned Platform lifecycle actionable delivery state.
CREATE TABLE IF NOT EXISTS `console_platform_lifecycle_actionables` (
  `operation_id` CHAR(36) NOT NULL,
  `generation` INT UNSIGNED NOT NULL DEFAULT 1,
  `actionable_key` VARCHAR(191) NOT NULL,
  `object_version` VARCHAR(191) NOT NULL,
  `recipient_uids_json` JSON NULL,
  `notification_id` VARCHAR(64) NULL,
  `published_at` DATETIME(3) NULL,
  `closure_state` VARCHAR(16) NULL,
  `closure_acknowledged_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`operation_id`, `generation`),
  KEY `idx_console_platform_lifecycle_actionable_pending`
    (`notification_id`, `closure_acknowledged_at`, `updated_at`),
  CONSTRAINT `fk_console_platform_lifecycle_actionable_operation`
    FOREIGN KEY (`operation_id`) REFERENCES `integration_operation` (`operation_id`) ON DELETE CASCADE,
  CONSTRAINT `ck_console_platform_lifecycle_actionable_closure`
    CHECK (`closure_state` IS NULL OR `closure_state` IN ('resolved', 'cancelled'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Optimistic concurrency columns used by Tenant Runtime mutations.
SET @console_cutover_ddl := IF(
  EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = @console_cutover_schema
       AND table_name = 'org_profiles'
       AND column_name = 'revision'
  ),
  'SELECT 1',
  'ALTER TABLE `org_profiles` ADD COLUMN `revision` BIGINT UNSIGNED NOT NULL DEFAULT 1 AFTER `status`'
);
PREPARE console_cutover_stmt FROM @console_cutover_ddl;
EXECUTE console_cutover_stmt;
DEALLOCATE PREPARE console_cutover_stmt;

SET @console_cutover_ddl := IF(
  EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = @console_cutover_schema
       AND table_name = 'org_business_domains'
       AND column_name = 'revision'
  ),
  'SELECT 1',
  'ALTER TABLE `org_business_domains` ADD COLUMN `revision` BIGINT UNSIGNED NOT NULL DEFAULT 1 AFTER `status`'
);
PREPARE console_cutover_stmt FROM @console_cutover_ddl;
EXECUTE console_cutover_stmt;
DEALLOCATE PREPARE console_cutover_stmt;

SET @console_cutover_ddl := IF(
  EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = @console_cutover_schema
       AND table_name = 'regions'
       AND column_name = 'revision'
  ),
  'SELECT 1',
  'ALTER TABLE `regions` ADD COLUMN `revision` BIGINT UNSIGNED NOT NULL DEFAULT 1 AFTER `status`'
);
PREPARE console_cutover_stmt FROM @console_cutover_ddl;
EXECUTE console_cutover_stmt;
DEALLOCATE PREPARE console_cutover_stmt;

SET @console_cutover_ddl := IF(
  EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = @console_cutover_schema
       AND table_name = 'setting_values'
       AND column_name = 'revision'
  ),
  'SELECT 1',
  'ALTER TABLE `setting_values` ADD COLUMN `revision` BIGINT UNSIGNED NOT NULL DEFAULT 1 AFTER `updated_by`'
);
PREPARE console_cutover_stmt FROM @console_cutover_ddl;
EXECUTE console_cutover_stmt;
DEALLOCATE PREPARE console_cutover_stmt;

SET @console_cutover_ddl := IF(
  EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = @console_cutover_schema
       AND table_name = 'work_calendars'
       AND column_name = 'revision'
  ),
  'SELECT 1',
  'ALTER TABLE `work_calendars` ADD COLUMN `revision` BIGINT UNSIGNED NOT NULL DEFAULT 1 AFTER `status`'
);
PREPARE console_cutover_stmt FROM @console_cutover_ddl;
EXECUTE console_cutover_stmt;
DEALLOCATE PREPARE console_cutover_stmt;

SET @console_cutover_ddl := IF(
  EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = @console_cutover_schema
       AND table_name = 'work_calendar_days'
       AND column_name = 'revision'
  ),
  'SELECT 1',
  'ALTER TABLE `work_calendar_days` ADD COLUMN `revision` BIGINT UNSIGNED NOT NULL DEFAULT 1 AFTER `remark`'
);
PREPARE console_cutover_stmt FROM @console_cutover_ddl;
EXECUTE console_cutover_stmt;
DEALLOCATE PREPARE console_cutover_stmt;

SET @console_cutover_ddl := IF(
  EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = @console_cutover_schema
       AND table_name = 'work_calendar_months'
       AND column_name = 'revision'
  ),
  'SELECT 1',
  'ALTER TABLE `work_calendar_months` ADD COLUMN `revision` BIGINT UNSIGNED NOT NULL DEFAULT 1 AFTER `source`'
);
PREPARE console_cutover_stmt FROM @console_cutover_ddl;
EXECUTE console_cutover_stmt;
DEALLOCATE PREPARE console_cutover_stmt;

-- Directory Connector runtime health fields.
SET @console_cutover_ddl := IF(
  EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = @console_cutover_schema
       AND table_name = 'directory_connectors'
       AND column_name = 'last_heartbeat_at'
  ),
  'SELECT 1',
  'ALTER TABLE `directory_connectors` ADD COLUMN `last_heartbeat_at` DATETIME(3) NULL AFTER `last_seen_at`'
);
PREPARE console_cutover_stmt FROM @console_cutover_ddl;
EXECUTE console_cutover_stmt;
DEALLOCATE PREPARE console_cutover_stmt;

SET @console_cutover_ddl := IF(
  EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = @console_cutover_schema
       AND table_name = 'directory_connectors'
       AND column_name = 'runtime_started_at'
  ),
  'SELECT 1',
  'ALTER TABLE `directory_connectors` ADD COLUMN `runtime_started_at` DATETIME(3) NULL AFTER `last_heartbeat_at`'
);
PREPARE console_cutover_stmt FROM @console_cutover_ddl;
EXECUTE console_cutover_stmt;
DEALLOCATE PREPARE console_cutover_stmt;

SET @console_cutover_ddl := IF(
  EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = @console_cutover_schema
       AND table_name = 'directory_connectors'
       AND column_name = 'metrics_json'
  ),
  'SELECT 1',
  'ALTER TABLE `directory_connectors` ADD COLUMN `metrics_json` JSON NULL AFTER `runtime_started_at`'
);
PREPARE console_cutover_stmt FROM @console_cutover_ddl;
EXECUTE console_cutover_stmt;
DEALLOCATE PREPARE console_cutover_stmt;

SET @console_cutover_ddl := IF(
  EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = @console_cutover_schema
       AND table_name = 'directory_connectors'
       AND column_name = 'revoked_at'
  ),
  'SELECT 1',
  'ALTER TABLE `directory_connectors` ADD COLUMN `revoked_at` DATETIME(3) NULL AFTER `metrics_json`'
);
PREPARE console_cutover_stmt FROM @console_cutover_ddl;
EXECUTE console_cutover_stmt;
DEALLOCATE PREPARE console_cutover_stmt;

-- Manifest indexes and constraints that were not covered by the older
-- domain-specific incremental migrations.
SET @console_cutover_ddl := IF(
  EXISTS (
    SELECT 1 FROM information_schema.statistics
     WHERE table_schema = @console_cutover_schema
       AND table_name = 'org_business_domains'
       AND index_name = 'idx_org_business_domains_category'
  ),
  'SELECT 1',
  'ALTER TABLE `org_business_domains` ADD KEY `idx_org_business_domains_category` (`category`, `sort_order`)'
);
PREPARE console_cutover_stmt FROM @console_cutover_ddl;
EXECUTE console_cutover_stmt;
DEALLOCATE PREPARE console_cutover_stmt;

SET @console_cutover_ddl := IF(
  EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE table_schema = @console_cutover_schema
       AND table_name = 'portal_notifications'
       AND constraint_name = 'ck_portal_notifications_request_hash'
  ),
  'SELECT 1',
  'ALTER TABLE `portal_notifications` ADD CONSTRAINT `ck_portal_notifications_request_hash` CHECK (`request_hash` REGEXP ''^[0-9a-f]{64}$'')'
);
PREPARE console_cutover_stmt FROM @console_cutover_ddl;
EXECUTE console_cutover_stmt;
DEALLOCATE PREPARE console_cutover_stmt;

SET @console_cutover_schema := NULL;
SET @console_cutover_ddl := NULL;
