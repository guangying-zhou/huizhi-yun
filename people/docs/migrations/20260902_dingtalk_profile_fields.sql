-- People DingTalk profile fields (2026-09-02). Safe to run repeatedly.
--
-- 手机号此前只以副作用形式存活在 `people_employees.metadata->$.directory_user.mobile`，
-- 而每次 HR 同步都会整体覆盖 metadata，因此任何一次缺手机号的钉钉快照都会让该字段
-- 永久送空；入职日期也没有来源标记，HR 手工修正会被下一次同步覆盖。
-- 本迁移把两者提升为一等列，并从既有 metadata 快照回填手机号。
SET NAMES utf8mb4;
USE `hzy_people`;

SET @mobile_missing := (
  SELECT COUNT(*) = 0
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'people_employees'
    AND COLUMN_NAME = 'mobile'
);

SET @ddl := IF(
  @mobile_missing,
  'ALTER TABLE `people_employees` ADD COLUMN `mobile` VARCHAR(64) NULL DEFAULT NULL COMMENT ''手机号；Console Directory 是登录身份事实源，此列用于同步与展示'' AFTER `login_name`',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @onboard_source_missing := (
  SELECT COUNT(*) = 0
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'people_employees'
    AND COLUMN_NAME = 'onboard_date_source'
);

SET @ddl := IF(
  @onboard_source_missing,
  'ALTER TABLE `people_employees` ADD COLUMN `onboard_date_source` ENUM(''dingtalk'', ''manual'') NOT NULL DEFAULT ''dingtalk'' COMMENT ''入职日期来源；manual 表示 HR 已修正，HR 事实源同步不得覆盖'' AFTER `onboard_date`',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 从既有 metadata 快照回填手机号。只回填当前为空的行，不覆盖任何已有值；
-- JSON null 与空串都视为“未提供”，不写入。
UPDATE `people_employees`
SET `mobile` = NULLIF(TRIM(JSON_UNQUOTE(JSON_EXTRACT(`metadata`, '$.directory_user.mobile'))), '')
WHERE `mobile` IS NULL
  AND `metadata` IS NOT NULL
  AND JSON_VALID(`metadata`)
  AND JSON_EXTRACT(`metadata`, '$.directory_user.mobile') IS NOT NULL
  AND JSON_TYPE(JSON_EXTRACT(`metadata`, '$.directory_user.mobile')) <> 'NULL'
  AND TRIM(JSON_UNQUOTE(JSON_EXTRACT(`metadata`, '$.directory_user.mobile'))) <> '';

SET @index_missing := (
  SELECT COUNT(*) = 0
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'people_employees'
    AND INDEX_NAME = 'idx_people_employee_onboard_date_source'
);

SET @ddl := IF(
  @index_missing,
  'ALTER TABLE `people_employees` ADD KEY `idx_people_employee_onboard_date_source` (`onboard_date_source`, `onboard_date`)',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
