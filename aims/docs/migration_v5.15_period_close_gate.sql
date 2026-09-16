-- Aims v5.15: PIVR V1.1 周期关期门、例外登记与结转治理。

DELIMITER $$

DROP PROCEDURE IF EXISTS `aims_apply_v5_15`$$
CREATE PROCEDURE `aims_apply_v5_15`()
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'milestone_cycle_snapshots' AND COLUMN_NAME = 'gate_result') THEN
    ALTER TABLE `milestone_cycle_snapshots` ADD COLUMN `gate_result` JSON DEFAULT NULL COMMENT '五项关期门逐项校验结果' AFTER `total_hours`;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'milestone_cycle_snapshots' AND COLUMN_NAME = 'gate_passed') THEN
    ALTER TABLE `milestone_cycle_snapshots` ADD COLUMN `gate_passed` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '关期门是否全部通过' AFTER `gate_result`;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'milestone_cycle_snapshots' AND COLUMN_NAME = 'exception_reason') THEN
    ALTER TABLE `milestone_cycle_snapshots` ADD COLUMN `exception_reason` TEXT DEFAULT NULL COMMENT '未通过项例外原因' AFTER `gate_passed`;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'milestone_cycle_snapshots' AND COLUMN_NAME = 'exception_owner_uid') THEN
    ALTER TABLE `milestone_cycle_snapshots` ADD COLUMN `exception_owner_uid` VARCHAR(64) DEFAULT NULL COMMENT '例外补救责任人' AFTER `exception_reason`;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'milestone_cycle_snapshots' AND COLUMN_NAME = 'exception_due_date') THEN
    ALTER TABLE `milestone_cycle_snapshots` ADD COLUMN `exception_due_date` DATE DEFAULT NULL COMMENT '例外计划关闭日期' AFTER `exception_owner_uid`;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'milestone_cycle_snapshots' AND COLUMN_NAME = 'confirmed_by') THEN
    ALTER TABLE `milestone_cycle_snapshots` ADD COLUMN `confirmed_by` VARCHAR(64) DEFAULT NULL COMMENT '关期确认人' AFTER `exception_due_date`;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'milestone_cycle_snapshots' AND COLUMN_NAME = 'confirmed_at') THEN
    ALTER TABLE `milestone_cycle_snapshots` ADD COLUMN `confirmed_at` DATETIME(6) DEFAULT NULL COMMENT '关期确认时间' AFTER `confirmed_by`;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'milestone_cycle_snapshots' AND COLUMN_NAME = 'sla_snapshot') THEN
    ALTER TABLE `milestone_cycle_snapshots` ADD COLUMN `sla_snapshot` JSON DEFAULT NULL COMMENT '关期时 SLA 执行快照，最终判定仍以 Altoc 为准' AFTER `confirmed_at`;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'milestone_cycle_snapshots' AND COLUMN_NAME = 'period_cost') THEN
    ALTER TABLE `milestone_cycle_snapshots` ADD COLUMN `period_cost` DECIMAL(14,2) DEFAULT NULL COMMENT '本周期已归集成本' AFTER `sla_snapshot`;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'work_items' AND COLUMN_NAME = 'carryover_origin_item_key') THEN
    ALTER TABLE `work_items` ADD COLUMN `carryover_origin_item_key` VARCHAR(64) DEFAULT NULL COMMENT '首次结转时冻结的原工作项标识' AFTER `is_unplanned`;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'work_items' AND COLUMN_NAME = 'carryover_origin_milestone_id') THEN
    ALTER TABLE `work_items` ADD COLUMN `carryover_origin_milestone_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '首次结转来源周期里程碑' AFTER `carryover_origin_item_key`;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'work_items' AND COLUMN_NAME = 'carryover_count') THEN
    ALTER TABLE `work_items` ADD COLUMN `carryover_count` SMALLINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '累计连续结转次数' AFTER `carryover_origin_milestone_id`;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'work_items' AND COLUMN_NAME = 'carryover_governance_abnormal') THEN
    ALTER TABLE `work_items` ADD COLUMN `carryover_governance_abnormal` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '连续结转三期及以上治理异常' AFTER `carryover_count`;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'work_items' AND INDEX_NAME = 'idx_work_item_carryover_governance') THEN
    ALTER TABLE `work_items` ADD KEY `idx_work_item_carryover_governance` (`project_id`, `carryover_governance_abnormal`, `carryover_count`);
  END IF;
END$$

CALL `aims_apply_v5_15`()$$
DROP PROCEDURE IF EXISTS `aims_apply_v5_15`$$

DELIMITER ;
