-- Console migration v1.1: expose committee as a distinct subject type
--
-- Purpose:
--   directory_departments.org_type='committee' was previously projected as
--   subject_type='department'. Platform authorization treats committees as
--   directory containers only, so the projection needs a distinct type that
--   Platform can filter reliably.
--
-- Preconditions:
--   1. Run this against the Console database, not the Platform database.
--      Typical dev DB: hzy_console.
--   2. directory_subject_exports exists.
--   3. directory_departments.org_type contains department / committee / virtual.
--
-- Notes:
--   - If the CHECK was already updated or does not exist in your MySQL version,
--     skip the DROP CHECK statement manually.
--   - The old department projection for committee dept_code is marked inactive
--     instead of deleted, so history remains inspectable.

CREATE TEMPORARY TABLE IF NOT EXISTS `tmp_console_subject_export_committee_guard` (
  `check_name` VARCHAR(64) NOT NULL PRIMARY KEY,
  `passed` TINYINT NOT NULL,
  CONSTRAINT `chk_tmp_console_subject_export_committee_guard_passed` CHECK (`passed` = 1)
) ENGINE=Memory;

TRUNCATE TABLE `tmp_console_subject_export_committee_guard`;

INSERT INTO `tmp_console_subject_export_committee_guard` (`check_name`, `passed`)
SELECT
  'console_tables_exist',
  IF(COUNT(*) = 2, 1, 0)
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN ('directory_subject_exports', 'directory_departments');

ALTER TABLE `directory_subject_exports`
  DROP CHECK `ck_directory_subject_exports_type`;

ALTER TABLE `directory_subject_exports`
  ADD CONSTRAINT `ck_directory_subject_exports_type`
    CHECK (`subject_type` IN ('user', 'department', 'committee', 'project'));

INSERT INTO `directory_subject_exports` (
  `subject_type`,
  `subject_code`,
  `external_ref`,
  `parent_subject_type`,
  `parent_subject_code`,
  `source_object_type`,
  `source_object_code`,
  `snapshot_hash`,
  `status`,
  `exported_at`,
  `created_at`,
  `updated_at`
)
SELECT
  'committee',
  dd.`dept_code`,
  SHA2(CONCAT('console:committee:', dd.`dept_code`), 256),
  CASE
    WHEN dd.`parent_dept_code` IS NULL THEN NULL
    WHEN parent_dept.`org_type` = 'committee' THEN 'committee'
    ELSE 'department'
  END,
  dd.`parent_dept_code`,
  'directory_departments',
  dd.`dept_code`,
  SHA2(CONCAT_WS('|', 'committee', dd.`dept_code`, COALESCE(dd.`parent_dept_code`, ''), dd.`status`), 256),
  dd.`status`,
  NOW(),
  NOW(),
  NOW()
FROM `directory_departments` dd
LEFT JOIN `directory_departments` parent_dept
  ON parent_dept.`dept_code` = dd.`parent_dept_code`
WHERE dd.`org_type` = 'committee'
ON DUPLICATE KEY UPDATE
  `external_ref` = VALUES(`external_ref`),
  `parent_subject_type` = VALUES(`parent_subject_type`),
  `parent_subject_code` = VALUES(`parent_subject_code`),
  `snapshot_hash` = VALUES(`snapshot_hash`),
  `status` = VALUES(`status`),
  `exported_at` = VALUES(`exported_at`),
  `updated_at` = VALUES(`updated_at`);

UPDATE `directory_subject_exports` dse
INNER JOIN `directory_departments` dd
  ON dd.`dept_code` = dse.`subject_code`
SET dse.`status` = 'inactive',
    dse.`snapshot_hash` = SHA2(CONCAT_WS('|', 'department', dd.`dept_code`, COALESCE(dd.`parent_dept_code`, ''), 'inactive'), 256),
    dse.`exported_at` = NOW(),
    dse.`updated_at` = NOW()
WHERE dse.`subject_type` = 'department'
  AND dd.`org_type` = 'committee';
