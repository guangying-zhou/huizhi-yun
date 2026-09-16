-- Aims v5.10
-- 里程碑完成申请期间冻结组成审批快照的验收事实。
-- 应用层仍负责返回友好错误；触发器负责关闭并发写入和遗漏入口。

DELIMITER $$

DROP PROCEDURE IF EXISTS `aims_require_v5_6_for_v5_10`$$
CREATE PROCEDURE `aims_require_v5_6_for_v5_10`()
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'milestones'
      AND COLUMN_NAME = 'completion_lock_request_id'
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Aims v5.10 requires completed v5.6 migration; milestones.completion_lock_request_id is missing';
  END IF;
END$$

CALL `aims_require_v5_6_for_v5_10`()$$
DROP PROCEDURE IF EXISTS `aims_require_v5_6_for_v5_10`$$

DELIMITER ;

DROP TRIGGER IF EXISTS `trg_milestone_completion_lock_update`;
DROP TRIGGER IF EXISTS `trg_milestone_completion_lock_delete`;
DROP TRIGGER IF EXISTS `trg_work_item_completion_lock_insert`;
DROP TRIGGER IF EXISTS `trg_work_item_completion_lock_update`;
DROP TRIGGER IF EXISTS `trg_work_item_completion_lock_delete`;
DROP TRIGGER IF EXISTS `trg_deliverable_completion_lock_insert`;
DROP TRIGGER IF EXISTS `trg_deliverable_completion_lock_update`;
DROP TRIGGER IF EXISTS `trg_deliverable_completion_lock_delete`;

DELIMITER $$

CREATE TRIGGER `trg_milestone_completion_lock_update`
BEFORE UPDATE ON `milestones`
FOR EACH ROW
BEGIN
  IF OLD.completion_lock_request_id IS NOT NULL
     AND NOT (
       NEW.completion_lock_request_id IS NULL
       AND (
         NEW.status <=> OLD.status
         OR (OLD.status = 'active' AND NEW.status = 'completed')
       )
       AND NEW.project_id <=> OLD.project_id
       AND NEW.name <=> OLD.name
       AND NEW.description <=> OLD.description
       AND NEW.mode <=> OLD.mode
       AND NEW.start_date <=> OLD.start_date
       AND NEW.end_date <=> OLD.end_date
       AND NEW.pivr_stage <=> OLD.pivr_stage
       AND NEW.template_key <=> OLD.template_key
       AND NEW.payment_term_id <=> OLD.payment_term_id
       AND NEW.recurrence_rule <=> OLD.recurrence_rule
       AND NEW.sort_order <=> OLD.sort_order
     )
  THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'milestone_completion_request_locked';
  END IF;
END$$

CREATE TRIGGER `trg_milestone_completion_lock_delete`
BEFORE DELETE ON `milestones`
FOR EACH ROW
BEGIN
  IF OLD.completion_lock_request_id IS NOT NULL THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'milestone_completion_request_locked';
  END IF;
END$$

CREATE TRIGGER `trg_work_item_completion_lock_insert`
BEFORE INSERT ON `work_items`
FOR EACH ROW
BEGIN
  IF EXISTS (
    SELECT 1 FROM `milestones`
    WHERE id = NEW.milestone_id
      AND completion_lock_request_id IS NOT NULL
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'milestone_completion_request_locked';
  END IF;
END$$

CREATE TRIGGER `trg_work_item_completion_lock_update`
BEFORE UPDATE ON `work_items`
FOR EACH ROW
BEGIN
  IF EXISTS (
    SELECT 1 FROM `milestones`
    WHERE id IN (OLD.milestone_id, NEW.milestone_id)
      AND completion_lock_request_id IS NOT NULL
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'milestone_completion_request_locked';
  END IF;
END$$

CREATE TRIGGER `trg_work_item_completion_lock_delete`
BEFORE DELETE ON `work_items`
FOR EACH ROW
BEGIN
  IF EXISTS (
    SELECT 1 FROM `milestones`
    WHERE id = OLD.milestone_id
      AND completion_lock_request_id IS NOT NULL
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'milestone_completion_request_locked';
  END IF;
END$$

CREATE TRIGGER `trg_deliverable_completion_lock_insert`
BEFORE INSERT ON `deliverables`
FOR EACH ROW
BEGIN
  IF EXISTS (
    SELECT 1
    FROM `milestones` m
    WHERE m.completion_lock_request_id IS NOT NULL
      AND m.id IN (
        COALESCE(NEW.milestone_owner_id, 0),
        COALESCE((SELECT wi.milestone_id FROM work_items wi WHERE wi.id = NEW.target_id), 0),
        COALESCE((SELECT wi.milestone_id FROM work_items wi WHERE wi.id = NEW.matter_id), 0)
      )
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'milestone_completion_request_locked';
  END IF;
END$$

CREATE TRIGGER `trg_deliverable_completion_lock_update`
BEFORE UPDATE ON `deliverables`
FOR EACH ROW
BEGIN
  IF EXISTS (
    SELECT 1
    FROM `milestones` m
    WHERE m.completion_lock_request_id IS NOT NULL
      AND m.id IN (
        COALESCE(OLD.milestone_owner_id, 0),
        COALESCE((SELECT wi.milestone_id FROM work_items wi WHERE wi.id = OLD.target_id), 0),
        COALESCE((SELECT wi.milestone_id FROM work_items wi WHERE wi.id = OLD.matter_id), 0),
        COALESCE(NEW.milestone_owner_id, 0),
        COALESCE((SELECT wi.milestone_id FROM work_items wi WHERE wi.id = NEW.target_id), 0),
        COALESCE((SELECT wi.milestone_id FROM work_items wi WHERE wi.id = NEW.matter_id), 0)
      )
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'milestone_completion_request_locked';
  END IF;
END$$

CREATE TRIGGER `trg_deliverable_completion_lock_delete`
BEFORE DELETE ON `deliverables`
FOR EACH ROW
BEGIN
  IF EXISTS (
    SELECT 1
    FROM `milestones` m
    WHERE m.completion_lock_request_id IS NOT NULL
      AND m.id IN (
        COALESCE(OLD.milestone_owner_id, 0),
        COALESCE((SELECT wi.milestone_id FROM work_items wi WHERE wi.id = OLD.target_id), 0),
        COALESCE((SELECT wi.milestone_id FROM work_items wi WHERE wi.id = OLD.matter_id), 0)
      )
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'milestone_completion_request_locked';
  END IF;
END$$

DELIMITER ;
