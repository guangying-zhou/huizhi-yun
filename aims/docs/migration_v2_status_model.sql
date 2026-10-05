-- ============================================================
-- 迁移脚本：工作项状态模型重构
-- Target 层：planning → todo → in_progress → in_review → completed
-- Matter 层：todo → in_progress → in_review → completed
-- ============================================================

USE `hzy_aims`;

-- Step 1: 删除外键约束
ALTER TABLE `work_items` DROP FOREIGN KEY `fk_item_type_status`;

-- Step 2: 迁移 work_items 中的旧状态到新状态
-- 需求旧状态映射
UPDATE `work_items` SET `status` = 'planning' WHERE `status` = 'draft' AND `tier` = 'target';
UPDATE `work_items` SET `status` = 'in_progress' WHERE `status` = 'developing';
UPDATE `work_items` SET `status` = 'in_review' WHERE `status` = 'reviewing';
UPDATE `work_items` SET `status` = 'todo' WHERE `status` = 'confirmed' AND `type` = 'requirement';

-- 任务旧状态映射
UPDATE `work_items` SET `status` = 'completed' WHERE `status` = 'done';

-- 缺陷旧状态映射
UPDATE `work_items` SET `status` = 'todo' WHERE `status` = 'new';
UPDATE `work_items` SET `status` = 'todo' WHERE `status` = 'confirmed' AND `type` = 'bug';
UPDATE `work_items` SET `status` = 'in_progress' WHERE `status` = 'fixing';
UPDATE `work_items` SET `status` = 'in_review' WHERE `status` = 'verifying';
UPDATE `work_items` SET `status` = 'completed' WHERE `status` = 'closed';

-- Matter 层的 draft 也改为 todo
UPDATE `work_items` SET `status` = 'todo' WHERE `status` = 'draft' AND `tier` = 'matter';

-- Step 3: 将 status 字段改为 ENUM 类型
ALTER TABLE `work_items`
  MODIFY COLUMN `status` ENUM('planning','todo','in_progress','in_review','completed')
  NOT NULL DEFAULT 'planning'
  COMMENT 'Target: planning→todo→in_progress→in_review→completed; Matter: todo→in_progress→in_review→completed';

-- Step 4: 重建 work_item_status_catalog 数据
TRUNCATE TABLE `work_item_status_catalog`;

-- 改 item_type ENUM 以支持按 tier 区分
ALTER TABLE `work_item_status_catalog`
  MODIFY COLUMN `item_type` VARCHAR(20) NOT NULL;

INSERT INTO `work_item_status_catalog` (`item_type`, `status`, `is_initial`, `is_terminal`, `sort_order`) VALUES
('target', 'planning', 1, 0, 10),
('target', 'todo', 0, 0, 20),
('target', 'in_progress', 0, 0, 30),
('target', 'in_review', 0, 0, 40),
('target', 'completed', 0, 1, 50),
('matter', 'todo', 1, 0, 10),
('matter', 'in_progress', 0, 0, 20),
('matter', 'in_review', 0, 0, 30),
('matter', 'completed', 0, 1, 40);

-- Step 5: 删除旧工作项流转和状态数据，改 ENUM 为 VARCHAR 以支持 target/matter
DELETE FROM `workflow_transitions` WHERE `entity_type` IN ('requirement', 'task', 'bug');
DELETE FROM `workflow_status_catalog` WHERE `entity_type` IN ('requirement', 'task', 'bug');

-- 先删外键再改类型
ALTER TABLE `workflow_transitions`
  DROP FOREIGN KEY `fk_transition_from_status`,
  DROP FOREIGN KEY `fk_transition_to_status`;

ALTER TABLE `workflow_transitions`
  MODIFY COLUMN `entity_type` VARCHAR(20) NOT NULL;

ALTER TABLE `workflow_status_catalog`
  MODIFY COLUMN `entity_type` VARCHAR(20) NOT NULL;

-- 重建外键
ALTER TABLE `workflow_transitions`
  ADD CONSTRAINT `fk_transition_from_status` FOREIGN KEY (`entity_type`, `from_status`) REFERENCES `workflow_status_catalog` (`entity_type`, `status`) ON UPDATE CASCADE ON DELETE RESTRICT,
  ADD CONSTRAINT `fk_transition_to_status` FOREIGN KEY (`entity_type`, `to_status`) REFERENCES `workflow_status_catalog` (`entity_type`, `status`) ON UPDATE CASCADE ON DELETE RESTRICT;

-- Step 6: 插入新的状态目录和流转规则
INSERT INTO `workflow_status_catalog` (`entity_type`, `status`, `is_initial`, `is_terminal`, `sort_order`) VALUES
('target', 'planning', 1, 0, 10),
('target', 'todo', 0, 0, 20),
('target', 'in_progress', 0, 0, 30),
('target', 'in_review', 0, 0, 40),
('target', 'completed', 0, 1, 50),
('matter', 'todo', 1, 0, 10),
('matter', 'in_progress', 0, 0, 20),
('matter', 'in_review', 0, 0, 30),
('matter', 'completed', 0, 1, 40);

INSERT INTO `workflow_transitions` (`project_id`, `entity_type`, `from_status`, `to_status`, `transition_key`) VALUES
-- Target 层
(NULL, 'target', 'planning', 'todo', 'decompose'),
(NULL, 'target', 'todo', 'in_progress', 'start'),
(NULL, 'target', 'in_progress', 'in_review', 'submit'),
(NULL, 'target', 'in_review', 'completed', 'approve'),
(NULL, 'target', 'in_review', 'in_progress', 'reject'),
(NULL, 'target', 'completed', 'in_progress', 'reopen'),
-- Matter 层
(NULL, 'matter', 'todo', 'in_progress', 'start'),
(NULL, 'matter', 'in_progress', 'in_review', 'submit'),
(NULL, 'matter', 'in_review', 'completed', 'approve'),
(NULL, 'matter', 'in_review', 'in_progress', 'reject'),
(NULL, 'matter', 'completed', 'in_progress', 'reopen');

-- Step 7: 同步更新 work_item_changelog 中的旧状态值（可选，不影响功能）
UPDATE `work_item_changelog` SET `old_value` = 'planning' WHERE `field_name` = 'status' AND `old_value` = 'draft';
UPDATE `work_item_changelog` SET `new_value` = 'planning' WHERE `field_name` = 'status' AND `new_value` = 'draft';
UPDATE `work_item_changelog` SET `old_value` = 'in_progress' WHERE `field_name` = 'status' AND `old_value` = 'developing';
UPDATE `work_item_changelog` SET `new_value` = 'in_progress' WHERE `field_name` = 'status' AND `new_value` = 'developing';
UPDATE `work_item_changelog` SET `old_value` = 'completed' WHERE `field_name` = 'status' AND `old_value` IN ('done', 'closed');
UPDATE `work_item_changelog` SET `new_value` = 'completed' WHERE `field_name` = 'status' AND `new_value` IN ('done', 'closed');
UPDATE `work_item_changelog` SET `old_value` = 'in_review' WHERE `field_name` = 'status' AND `old_value` IN ('reviewing', 'verifying');
UPDATE `work_item_changelog` SET `new_value` = 'in_review' WHERE `field_name` = 'status' AND `new_value` IN ('reviewing', 'verifying');
UPDATE `work_item_changelog` SET `old_value` = 'todo' WHERE `field_name` = 'status' AND `old_value` IN ('new', 'confirmed');
UPDATE `work_item_changelog` SET `new_value` = 'todo' WHERE `field_name` = 'status' AND `new_value` IN ('new', 'confirmed');
UPDATE `work_item_changelog` SET `old_value` = 'in_progress' WHERE `field_name` = 'status' AND `old_value` = 'fixing';
UPDATE `work_item_changelog` SET `new_value` = 'in_progress' WHERE `field_name` = 'status' AND `new_value` = 'fixing';
