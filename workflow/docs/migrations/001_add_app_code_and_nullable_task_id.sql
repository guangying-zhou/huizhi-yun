-- ============================================================
-- 迁移脚本 001: 增加 app_code 维度 + task_id 可空 + 种子数据修正
-- 日期: 2026-03-19
-- 说明:
--   1. flow_action_defs 增加 app_code 字段，唯一约束改为三元组
--   2. flow_instances 增加 app_code 字段
--   3. flow_actions.task_id 改为可空，外键改为 ON DELETE SET NULL
--   4. 修正种子数据（节点结构、config 字段名、路由条件格式）
-- ============================================================

USE `hzy_workflow`;

-- -----------------------------------------------------------
-- 1. flow_action_defs: 增加 app_code
-- -----------------------------------------------------------

-- 添加 app_code 列（先给默认值 'codocs'，后续按需修改）
ALTER TABLE `flow_action_defs`
    ADD COLUMN `app_code` VARCHAR(50) NOT NULL DEFAULT 'codocs' COMMENT '应用编码（对应 account.applications.app_code），如 codocs'
    AFTER `id`;

-- 删除旧唯一约束，创建新的三元组唯一约束
ALTER TABLE `flow_action_defs`
    DROP INDEX `uk_resource_action`,
    ADD UNIQUE KEY `uk_app_resource_action` (`app_code`, `resource_code`, `action_code`);

-- 去掉默认值（后续新增记录必须显式传入）
ALTER TABLE `flow_action_defs`
    ALTER COLUMN `app_code` DROP DEFAULT;

-- -----------------------------------------------------------
-- 2. flow_instances: 增加 app_code
-- -----------------------------------------------------------

ALTER TABLE `flow_instances`
    ADD COLUMN `app_code` VARCHAR(50) NOT NULL DEFAULT 'codocs' COMMENT '冗余：应用编码'
    AFTER `flow_schema_id`;

-- 回填已有数据（从关联的 action_def 取 app_code）
UPDATE `flow_instances` fi
    JOIN `flow_action_defs` fad ON fi.action_def_id = fad.id
    SET fi.app_code = fad.app_code;

-- 去掉默认值
ALTER TABLE `flow_instances`
    ALTER COLUMN `app_code` DROP DEFAULT;

-- -----------------------------------------------------------
-- 3. flow_actions: task_id 改为可空
-- -----------------------------------------------------------

-- 先删除外键约束
ALTER TABLE `flow_actions`
    DROP FOREIGN KEY `fk_actions_task`;

-- 修改列为可空
ALTER TABLE `flow_actions`
    MODIFY COLUMN `task_id` BIGINT UNSIGNED NULL COMMENT '关联任务（resubmit/cancel/remind 等实例级操作可为空）';

-- 重建外键（ON DELETE SET NULL）
ALTER TABLE `flow_actions`
    ADD CONSTRAINT `fk_actions_task` FOREIGN KEY (`task_id`) REFERENCES `flow_tasks`(`id`) ON DELETE SET NULL;

-- 修正已有的 task_id = 0 的记录（如果有的话）
UPDATE `flow_actions` SET `task_id` = NULL WHERE `task_id` = 0;

-- -----------------------------------------------------------
-- 4. 修正种子数据：流程定义节点结构
--    assignee(单数) → assignees(数组)
--    config 字段名统一
-- -----------------------------------------------------------

-- 三级审批流程
UPDATE `flow_schemas` SET
    `nodes` = JSON_ARRAY(
        JSON_OBJECT('name', '直属上级审批', 'type', 'approve', 'approve_mode', 'any', 'assignees', JSON_ARRAY(
            JSON_OBJECT('type', 'initiator_leader')
        )),
        JSON_OBJECT('name', '部门负责人审批', 'type', 'approve', 'approve_mode', 'any', 'assignees', JSON_ARRAY(
            JSON_OBJECT('type', 'dept_manager', 'scope', 'initiator_dept')
        ), 'skip_when', JSON_OBJECT('initiator_role', 'dept_manager')),
        JSON_OBJECT('name', '分管领导审批', 'type', 'approve', 'approve_mode', 'any', 'assignees', JSON_ARRAY(
            JSON_OBJECT('type', 'dept_leader', 'scope', 'initiator_dept')
        ))
    ),
    `config` = JSON_OBJECT('allow_withdraw', true, 'allow_resubmit', true, 'reject_strategy', 'to_initiator')
WHERE `code` = 'sequential_3level';

-- 两级审批流程
UPDATE `flow_schemas` SET
    `nodes` = JSON_ARRAY(
        JSON_OBJECT('name', '部门负责人审批', 'type', 'approve', 'approve_mode', 'any', 'assignees', JSON_ARRAY(
            JSON_OBJECT('type', 'dept_manager', 'scope', 'initiator_dept')
        )),
        JSON_OBJECT('name', '分管领导审批', 'type', 'approve', 'approve_mode', 'any', 'assignees', JSON_ARRAY(
            JSON_OBJECT('type', 'dept_leader', 'scope', 'initiator_dept')
        ))
    ),
    `config` = JSON_OBJECT('allow_withdraw', true, 'allow_resubmit', true, 'reject_strategy', 'to_initiator')
WHERE `code` = 'sequential_2level';

-- 委员会表决流程
UPDATE `flow_schemas` SET
    `nodes` = JSON_ARRAY(
        JSON_OBJECT('name', '委员会成员会签', 'type', 'countersign', 'approve_mode', 'all', 'assignees', JSON_ARRAY(
            JSON_OBJECT('type', 'role', 'code', 'committee_member', 'scope', 'resource_dept')
        )),
        JSON_OBJECT('name', '委员会主任确认', 'type', 'approve', 'approve_mode', 'any', 'assignees', JSON_ARRAY(
            JSON_OBJECT('type', 'dept_manager', 'scope', 'resource_dept')
        ))
    ),
    `config` = JSON_OBJECT('allow_withdraw', false, 'allow_resubmit', true, 'reject_strategy', 'to_initiator')
WHERE `code` = 'committee_vote';

-- -----------------------------------------------------------
-- 5. 修正种子数据：路由条件格式（嵌套 → 扁平）
-- -----------------------------------------------------------

UPDATE `flow_routes` SET
    `conditions` = JSON_OBJECT('dept_org_type', 'committee')
WHERE `name` = '委员会发文走表决流程';
