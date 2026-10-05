-- Console migration v1.2: mark stale subject exports inactive
--
-- Purpose:
--   If a Console directory source row was hard-deleted, the old
--   directory_subject_exports row could remain active. Platform only sees this
--   minimal projection, so stale active exports keep tenant_subjects active.
--
-- Preconditions:
--   1. Run this against the Console database, not the Platform database.
--      Typical dev DB: hzy_console.
--   2. directory_subject_exports, directory_users, directory_departments and
--      directory_projects exist.
--
-- Notes:
--   - This preserves the export rows for audit/history, but changes them to
--     inactive so the next Platform subject sync disables the corresponding
--     tenant_subjects rows.

CREATE TEMPORARY TABLE IF NOT EXISTS `tmp_console_stale_subject_exports_guard` (
  `check_name` VARCHAR(64) NOT NULL PRIMARY KEY,
  `passed` TINYINT NOT NULL,
  CONSTRAINT `chk_tmp_console_stale_subject_exports_guard_passed` CHECK (`passed` = 1)
) ENGINE=Memory;

TRUNCATE TABLE `tmp_console_stale_subject_exports_guard`;

INSERT INTO `tmp_console_stale_subject_exports_guard` (`check_name`, `passed`)
SELECT
  'console_tables_exist',
  IF(COUNT(*) = 4, 1, 0)
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN (
    'directory_subject_exports',
    'directory_users',
    'directory_departments',
    'directory_projects'
  );

START TRANSACTION;

UPDATE `directory_subject_exports` dse
LEFT JOIN `directory_users` u
  ON u.`uid` = dse.`source_object_code`
SET dse.`status` = 'inactive',
    dse.`snapshot_hash` = SHA2(CONCAT_WS('|', dse.`subject_type`, dse.`subject_code`, COALESCE(dse.`parent_subject_type`, ''), COALESCE(dse.`parent_subject_code`, ''), 'inactive'), 256),
    dse.`exported_at` = NOW(),
    dse.`updated_at` = NOW()
WHERE dse.`source_object_type` = 'directory_users'
  AND dse.`subject_type` = 'user'
  AND u.`uid` IS NULL
  AND dse.`status` = 'active';

UPDATE `directory_subject_exports` dse
LEFT JOIN `directory_departments` dd
  ON dd.`dept_code` = dse.`source_object_code`
SET dse.`status` = 'inactive',
    dse.`snapshot_hash` = SHA2(CONCAT_WS('|', dse.`subject_type`, dse.`subject_code`, COALESCE(dse.`parent_subject_type`, ''), COALESCE(dse.`parent_subject_code`, ''), 'inactive'), 256),
    dse.`exported_at` = NOW(),
    dse.`updated_at` = NOW()
WHERE dse.`source_object_type` = 'directory_departments'
  AND dse.`subject_type` IN ('department', 'committee')
  AND dd.`dept_code` IS NULL
  AND dse.`status` = 'active';

UPDATE `directory_subject_exports` dse
LEFT JOIN `directory_projects` p
  ON p.`project_code` = dse.`source_object_code`
SET dse.`status` = 'inactive',
    dse.`snapshot_hash` = SHA2(CONCAT_WS('|', dse.`subject_type`, dse.`subject_code`, COALESCE(dse.`parent_subject_type`, ''), COALESCE(dse.`parent_subject_code`, ''), 'inactive'), 256),
    dse.`exported_at` = NOW(),
    dse.`updated_at` = NOW()
WHERE dse.`source_object_type` = 'directory_projects'
  AND dse.`subject_type` = 'project'
  AND p.`project_code` IS NULL
  AND dse.`status` = 'active';

COMMIT;

-- Post-check: rows listed here are still active exports whose source row is gone.
SELECT
  dse.`subject_type`,
  dse.`subject_code`,
  dse.`source_object_type`,
  dse.`source_object_code`,
  dse.`status`
FROM `directory_subject_exports` dse
LEFT JOIN `directory_users` u
  ON dse.`source_object_type` = 'directory_users'
 AND u.`uid` = dse.`source_object_code`
LEFT JOIN `directory_departments` dd
  ON dse.`source_object_type` = 'directory_departments'
 AND dd.`dept_code` = dse.`source_object_code`
LEFT JOIN `directory_projects` p
  ON dse.`source_object_type` = 'directory_projects'
 AND p.`project_code` = dse.`source_object_code`
WHERE dse.`status` = 'active'
  AND (
    (dse.`source_object_type` = 'directory_users' AND u.`uid` IS NULL)
    OR (dse.`source_object_type` = 'directory_departments' AND dd.`dept_code` IS NULL)
    OR (dse.`source_object_type` = 'directory_projects' AND p.`project_code` IS NULL)
  )
ORDER BY dse.`subject_type`, dse.`subject_code`;
