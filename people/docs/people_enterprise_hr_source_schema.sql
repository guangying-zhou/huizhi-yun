-- APF-17a fixed incremental candidate; no FK/CASCADE, no environment execution.
CREATE TABLE `people_hr_source_state` (
  `provider_code` VARCHAR(32) NOT NULL,
  `row_version` BIGINT UNSIGNED NOT NULL DEFAULT 1,
  `pending_key` VARCHAR(191) DEFAULT NULL,
  `updated_by` VARCHAR(64) DEFAULT NULL,
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`provider_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
