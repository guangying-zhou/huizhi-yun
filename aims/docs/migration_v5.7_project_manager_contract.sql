-- v5.7 项目经理必填收口迁移
-- 前置条件：
--   1. 已执行 migration_v5.6_project_governance.sql。
--   2. 已由业务负责人逐项修复所有 leader_uid 为空的历史项目。
-- 本迁移只做 contract，不推测、不自动回填项目经理。

DROP PROCEDURE IF EXISTS `aims_contract_project_manager_required`;

DELIMITER $$

CREATE PROCEDURE `aims_contract_project_manager_required`()
BEGIN
  DECLARE invalid_project_count BIGINT DEFAULT 0;

  SELECT COUNT(*)
    INTO invalid_project_count
  FROM `aims_projects`
  WHERE `leader_uid` IS NULL OR TRIM(`leader_uid`) = '';

  IF invalid_project_count > 0 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'project_manager_contract_blocked: repair aims_projects.leader_uid first';
  END IF;

  ALTER TABLE `aims_projects`
    MODIFY COLUMN `leader_uid` VARCHAR(64) NOT NULL COMMENT '项目负责人(关联Account)';
END$$

DELIMITER ;

CALL `aims_contract_project_manager_required`();
DROP PROCEDURE IF EXISTS `aims_contract_project_manager_required`;

SELECT
  column_name,
  is_nullable,
  column_type
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND table_name = 'aims_projects'
  AND column_name = 'leader_uid';
