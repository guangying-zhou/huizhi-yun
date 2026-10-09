-- Assets P3: durable offboarding projection, explicit recovery responsibility and reliable notification stream.
-- Repeatable on MySQL 8. Does not backfill from asset owners, departments, administrators or configuration.
CREATE TABLE IF NOT EXISTS `asset_offboarding_recovery_cases` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `case_code` VARCHAR(64) NOT NULL,
  `source_app` VARCHAR(50) NOT NULL,
  `source_event_key` VARCHAR(191) NOT NULL,
  `source_payload_sha256` CHAR(64) NOT NULL,
  `departed_employee_uid` VARCHAR(64) NOT NULL,
  `departed_employee_name` VARCHAR(191) DEFAULT NULL,
  `offboarded_at` DATETIME NOT NULL,
  `recovery_due_at` DATE NOT NULL,
  `recovery_responsible_uid` VARCHAR(64) DEFAULT NULL,
  `status` ENUM('active','resolved','cancelled') NOT NULL DEFAULT 'active',
  `created_by` VARCHAR(64) DEFAULT NULL,
  `updated_by` VARCHAR(64) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_aorc_case_code` (`case_code`),
  UNIQUE KEY `uk_aorc_source_event` (`source_app`, `source_event_key`),
  KEY `idx_aorc_due` (`status`, `recovery_due_at`, `id`),
  KEY `idx_aorc_departed` (`departed_employee_uid`, `status`),
  KEY `idx_aorc_responsible` (`recovery_responsible_uid`, `status`, `recovery_due_at`),
  CONSTRAINT `chk_aorc_identity` CHECK (`case_code`=TRIM(`case_code`) AND `case_code`<>'' AND `source_app`='people' AND `source_event_key`=TRIM(`source_event_key`) AND `source_event_key`<>'' AND `source_payload_sha256` REGEXP '^[0-9a-f]{64}$' AND `departed_employee_uid`=TRIM(`departed_employee_uid`) AND `departed_employee_uid`<>'' AND LOWER(`departed_employee_uid`)<>'@all'),
  CONSTRAINT `chk_aorc_responsible` CHECK (`recovery_responsible_uid` IS NULL OR (`recovery_responsible_uid`=TRIM(`recovery_responsible_uid`) AND `recovery_responsible_uid`<>'' AND LOWER(`recovery_responsible_uid`)<>'@all' AND `recovery_responsible_uid`<>`departed_employee_uid` AND `recovery_responsible_uid` NOT REGEXP '[[:cntrl:]]'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Assets 离职员工未归还资产回收事项';

ALTER TABLE `assets_notification_checkpoint`
  MODIFY COLUMN `event_stream` ENUM('resource_expiry','ip_expiry','delivery_expiry','delivery_warranty','delivery_support','offboarding_unrecovered') NOT NULL,
  MODIFY COLUMN `source_type` ENUM('asset_item','ip_asset','customer_delivery_asset','offboarding_recovery_case') NOT NULL;
