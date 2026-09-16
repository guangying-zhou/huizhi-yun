-- Aims v5.14: PIVR V1.1 服务年度与日常事务归属。
--
-- MySQL 8 不支持所有目标环境上的 ADD COLUMN IF NOT EXISTS，使用
-- information_schema 守卫，允许迁移在安装/修复流程中安全重放。

DELIMITER $$

DROP PROCEDURE IF EXISTS `aims_apply_v5_14`$$
CREATE PROCEDURE `aims_apply_v5_14`()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'aims_projects' AND COLUMN_NAME = 'service_line_code'
  ) THEN
    ALTER TABLE `aims_projects`
      ADD COLUMN `service_line_code` VARCHAR(64) DEFAULT NULL
        COMMENT '服务链标识，串联同一客户同一服务的历年项目' AFTER `contract_code`;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'aims_projects' AND COLUMN_NAME = 'service_period_seq'
  ) THEN
    ALTER TABLE `aims_projects`
      ADD COLUMN `service_period_seq` SMALLINT UNSIGNED DEFAULT NULL
        COMMENT '服务年度序号' AFTER `service_line_code`;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'aims_projects' AND COLUMN_NAME = 'service_period_start'
  ) THEN
    ALTER TABLE `aims_projects`
      ADD COLUMN `service_period_start` DATE DEFAULT NULL
        COMMENT '服务年度开始日期' AFTER `service_period_seq`;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'aims_projects' AND COLUMN_NAME = 'service_period_end'
  ) THEN
    ALTER TABLE `aims_projects`
      ADD COLUMN `service_period_end` DATE DEFAULT NULL
        COMMENT '服务年度结束日期' AFTER `service_period_start`;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'aims_projects' AND COLUMN_NAME = 'service_period_label'
  ) THEN
    ALTER TABLE `aims_projects`
      ADD COLUMN `service_period_label` VARCHAR(32) DEFAULT NULL
        COMMENT '服务年度展示标签，如 2026.03-2027.02' AFTER `service_period_end`;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'aims_projects' AND INDEX_NAME = 'idx_service_line'
  ) THEN
    ALTER TABLE `aims_projects`
      ADD KEY `idx_service_line` (`service_line_code`, `service_period_seq`);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'work_items' AND COLUMN_NAME = 'routine_scope'
  ) THEN
    ALTER TABLE `work_items`
      ADD COLUMN `routine_scope` ENUM('department','cross_dept') DEFAULT NULL
        COMMENT '日常事务归属，仅 routine 类项目使用' AFTER `template_key`;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'work_items' AND COLUMN_NAME = 'beneficiary_dept_code'
  ) THEN
    ALTER TABLE `work_items`
      ADD COLUMN `beneficiary_dept_code` VARCHAR(50) DEFAULT NULL
        COMMENT '受益部门，routine_scope=cross_dept 时必填' AFTER `routine_scope`;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'work_items' AND COLUMN_NAME = 'is_unplanned'
  ) THEN
    ALTER TABLE `work_items`
      ADD COLUMN `is_unplanned` TINYINT(1) NOT NULL DEFAULT 0
        COMMENT '计划外工作标记' AFTER `beneficiary_dept_code`;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'work_items' AND INDEX_NAME = 'idx_routine_beneficiary'
  ) THEN
    ALTER TABLE `work_items`
      ADD KEY `idx_routine_beneficiary` (`beneficiary_dept_code`, `routine_scope`);
  END IF;

  -- routine 项目不生成里程碑，因此其工作项允许 milestone_id=NULL。
  -- 非 routine 项目的必填约束由 data-runtime 继续执行。
  IF EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'work_items'
      AND COLUMN_NAME = 'milestone_id' AND IS_NULLABLE = 'NO'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.REFERENTIAL_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'work_items'
        AND CONSTRAINT_NAME = 'fk_item_project_milestone'
    ) THEN
      ALTER TABLE `work_items` DROP FOREIGN KEY `fk_item_project_milestone`;
    END IF;
    ALTER TABLE `work_items`
      MODIFY COLUMN `milestone_id` BIGINT UNSIGNED DEFAULT NULL
        COMMENT '所属里程碑；routine 项目可空，其余项目必填';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.REFERENTIAL_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'work_items'
      AND CONSTRAINT_NAME = 'fk_item_project_milestone'
  ) THEN
    ALTER TABLE `work_items`
      ADD CONSTRAINT `fk_item_project_milestone`
      FOREIGN KEY (`project_id`, `milestone_id`)
      REFERENCES `milestones` (`project_id`, `id`) ON DELETE RESTRICT;
  END IF;
END$$

CALL `aims_apply_v5_14`()$$
DROP PROCEDURE IF EXISTS `aims_apply_v5_14`$$

DELIMITER ;

SELECT `project_code`, `service_line_code`, `service_period_seq`,
       `service_period_start`, `service_period_end`, `service_period_label`
FROM `aims_projects`
WHERE `service_line_code` IS NOT NULL
ORDER BY `service_line_code`, `service_period_seq`;
