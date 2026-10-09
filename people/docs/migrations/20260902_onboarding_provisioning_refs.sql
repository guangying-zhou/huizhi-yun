-- People 入职单的开通引用 (2026-09-02)。可重复执行。
--
-- 入职单需要记住它在 Console 侧的预留与建号 operation，才能在员工激活前
-- 验真「LDAP 账号确实创建成功」，而不是相信浏览器声称已创建。
SET NAMES utf8mb4;
USE `hzy_people`;

SET @reservation_missing := (
  SELECT COUNT(*) = 0 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'people_onboarding_cases'
    AND COLUMN_NAME = 'reservation_id'
);
SET @ddl := IF(
  @reservation_missing,
  'ALTER TABLE `people_onboarding_cases` ADD COLUMN `reservation_id` CHAR(36) NULL DEFAULT NULL COMMENT ''Console 身份预留 ID'' AFTER `canonical_uid`',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @operation_missing := (
  SELECT COUNT(*) = 0 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'people_onboarding_cases'
    AND COLUMN_NAME = 'provision_operation_id'
);
SET @ddl := IF(
  @operation_missing,
  'ALTER TABLE `people_onboarding_cases` ADD COLUMN `provision_operation_id` CHAR(36) NULL DEFAULT NULL COMMENT ''Console LDAP 建号 operation ID；员工激活前据此验真'' AFTER `reservation_id`',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @index_missing := (
  SELECT COUNT(*) = 0 FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'people_onboarding_cases'
    AND INDEX_NAME = 'idx_people_onboarding_provision_operation'
);
SET @ddl := IF(
  @index_missing,
  'ALTER TABLE `people_onboarding_cases` ADD KEY `idx_people_onboarding_provision_operation` (`provision_operation_id`)',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
