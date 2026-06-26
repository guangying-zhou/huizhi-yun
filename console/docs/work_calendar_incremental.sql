-- Console work calendar incremental DDL
-- Safe to run on an existing hzy_console database. It does not drop or rebuild data.

CREATE TABLE IF NOT EXISTS `work_calendars` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `calendar_code` VARCHAR(64) NOT NULL COMMENT '稳定日历编码，如 CN',
  `calendar_name` VARCHAR(255) NOT NULL,
  `region_code` VARCHAR(32) NOT NULL DEFAULT 'CN' COMMENT 'holiday-calendar region code',
  `timezone` VARCHAR(64) NOT NULL DEFAULT 'Asia/Shanghai',
  `standard_hours_per_day` DECIMAL(5,2) NOT NULL DEFAULT 8.00,
  `weekend_days_json` JSON NULL COMMENT '0=Sunday, 6=Saturday',
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_work_calendars_code` (`calendar_code`),
  KEY `idx_work_calendars_region` (`region_code`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `work_calendar_days` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `calendar_code` VARCHAR(64) NOT NULL,
  `work_date` DATE NOT NULL,
  `year_no` SMALLINT UNSIGNED NOT NULL,
  `year_month` CHAR(7) NOT NULL,
  `day_of_week` TINYINT UNSIGNED NOT NULL COMMENT '0=Sunday, 6=Saturday',
  `day_type` VARCHAR(32) NOT NULL COMMENT 'workday / weekend / public_holiday / transfer_workday / custom_holiday / custom_workday',
  `is_workday` TINYINT(1) NOT NULL DEFAULT 0,
  `holiday_name` VARCHAR(255) NULL,
  `source` VARCHAR(64) NOT NULL DEFAULT 'generated' COMMENT 'generated / holiday-calendar / manual-import / manual',
  `source_ref` VARCHAR(255) NULL,
  `import_batch` VARCHAR(64) NULL,
  `remark` VARCHAR(500) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_work_calendar_days_date` (`calendar_code`, `work_date`),
  KEY `idx_work_calendar_days_month` (`calendar_code`, `year_month`, `is_workday`),
  KEY `idx_work_calendar_days_year` (`calendar_code`, `year_no`),
  CONSTRAINT `fk_work_calendar_days_calendar`
    FOREIGN KEY (`calendar_code`) REFERENCES `work_calendars` (`calendar_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `work_calendar_months` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `calendar_code` VARCHAR(64) NOT NULL,
  `year_month` CHAR(7) NOT NULL,
  `year_no` SMALLINT UNSIGNED NOT NULL,
  `month_no` TINYINT UNSIGNED NOT NULL,
  `workday_count` INT NOT NULL DEFAULT 0,
  `non_workday_count` INT NOT NULL DEFAULT 0,
  `standard_hours_per_day` DECIMAL(5,2) NOT NULL DEFAULT 8.00,
  `standard_work_hours` DECIMAL(8,2) NOT NULL DEFAULT 0.00,
  `source` VARCHAR(64) NOT NULL DEFAULT 'generated',
  `calculated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_work_calendar_months` (`calendar_code`, `year_month`),
  KEY `idx_work_calendar_months_year` (`calendar_code`, `year_no`),
  CONSTRAINT `fk_work_calendar_months_calendar`
    FOREIGN KEY (`calendar_code`) REFERENCES `work_calendars` (`calendar_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `work_calendar_import_jobs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `job_code` VARCHAR(64) NOT NULL,
  `calendar_code` VARCHAR(64) NOT NULL,
  `region_code` VARCHAR(32) NOT NULL,
  `year_no` SMALLINT UNSIGNED NOT NULL,
  `import_mode` VARCHAR(32) NOT NULL DEFAULT 'auto',
  `source` VARCHAR(64) NOT NULL,
  `source_url` VARCHAR(500) NULL,
  `imported_days` INT NOT NULL DEFAULT 0,
  `status` VARCHAR(32) NOT NULL DEFAULT 'success',
  `message` VARCHAR(500) NULL,
  `requested_by` VARCHAR(64) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `completed_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_work_calendar_import_jobs` (`job_code`),
  KEY `idx_work_calendar_import_jobs_calendar` (`calendar_code`, `year_no`, `created_at`),
  CONSTRAINT `fk_work_calendar_import_jobs_calendar`
    FOREIGN KEY (`calendar_code`) REFERENCES `work_calendars` (`calendar_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `work_calendars` (
  `calendar_code`,
  `calendar_name`,
  `region_code`,
  `timezone`,
  `standard_hours_per_day`,
  `weekend_days_json`,
  `status`,
  `created_at`,
  `updated_at`
) VALUES (
  'CN',
  '中国大陆工作日历',
  'CN',
  'Asia/Shanghai',
  8.00,
  JSON_ARRAY(0, 6),
  'active',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
)
ON DUPLICATE KEY UPDATE
  `updated_at` = `updated_at`;

-- Finance reads Console monthly standard work hours when calculating standard labor cost.
INSERT INTO `service_client_grants` (
  `service_client_id`,
  `resource_code`,
  `action`,
  `scope_json`,
  `status`,
  `created_at`,
  `updated_at`
)
SELECT
  sc.`id`,
  'system_settings',
  'view',
  JSON_OBJECT(
    'source', 'work_calendar_incremental',
    'purpose', 'finance-read-console-work-calendar-month'
  ),
  'active',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
FROM `service_clients` sc
WHERE sc.`status` = 'active'
  AND (sc.`app_code` = 'finance' OR sc.`client_code` IN ('finance', 'finance.runtime'))
ON DUPLICATE KEY UPDATE
  `scope_json` = VALUES(`scope_json`),
  `status` = 'active',
  `updated_at` = UTC_TIMESTAMP();
