-- APF-17b candidate only; use domaininstall, do not source into an environment.
CREATE TABLE `people_offboarding_cases` (
 `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 `case_code` VARCHAR(64) NOT NULL, `employee_uid` VARCHAR(64) NOT NULL,
 `effective_date` DATE NOT NULL, `status` ENUM('awaiting_arrangement','active','completed','cancelled') NOT NULL DEFAULT 'awaiting_arrangement',
 `row_version` BIGINT UNSIGNED NOT NULL DEFAULT 1,
 `created_by` VARCHAR(64) NOT NULL, `updated_by` VARCHAR(64) NOT NULL,
 `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 UNIQUE KEY `uk_people_offboarding_event` (`employee_uid`,`effective_date`), UNIQUE KEY `uk_people_offboarding_code` (`case_code`),
 KEY `idx_people_offboarding_status` (`status`,`id`),
 CONSTRAINT `ck_people_offboarding_version` CHECK (`row_version`>0),
 CONSTRAINT `ck_people_offboarding_uid` CHECK (`employee_uid`=TRIM(`employee_uid`) AND `employee_uid`<>'' AND LOWER(`employee_uid`) NOT LIKE 'dt-%')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `people_offboarding_tasks` (
 `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 `case_id` BIGINT UNSIGNED NOT NULL, `task_type` ENUM('handover','asset_recovery_coordination') NOT NULL,
 `responsible_uid` VARCHAR(64) NOT NULL, `due_at` DATETIME(3) NOT NULL,
 `status` ENUM('pending','completed','cancelled') NOT NULL DEFAULT 'pending', `row_version` BIGINT UNSIGNED NOT NULL DEFAULT 1,
 `finished_by` VARCHAR(64) NULL, `finished_at` DATETIME(3) NULL, `cancellation_reason` VARCHAR(500) NULL,
 `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 UNIQUE KEY `uk_people_offboarding_task` (`case_id`,`task_type`), KEY `idx_people_offboarding_responsible` (`responsible_uid`,`status`,`due_at`),
 CONSTRAINT `fk_people_offboarding_task_case` FOREIGN KEY (`case_id`) REFERENCES `people_offboarding_cases` (`id`),
 CONSTRAINT `ck_people_offboarding_task_version` CHECK (`row_version`>0),
 CONSTRAINT `ck_people_offboarding_task_responsible` CHECK (`responsible_uid`=TRIM(`responsible_uid`) AND `responsible_uid`<>'' AND LOWER(`responsible_uid`) NOT LIKE 'dt-%'),
 CONSTRAINT `ck_people_offboarding_task_terminal` CHECK (
 (`status`='pending' AND `finished_by` IS NULL AND `finished_at` IS NULL AND `cancellation_reason` IS NULL) OR
 (`status`='completed' AND `finished_by` IS NOT NULL AND `finished_at` IS NOT NULL AND `cancellation_reason` IS NULL) OR
 (`status`='cancelled' AND `finished_by` IS NOT NULL AND `finished_at` IS NOT NULL AND LENGTH(TRIM(`cancellation_reason`))>0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
