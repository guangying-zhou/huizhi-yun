-- ============================================================
-- Workflow 流程引擎模块 - 数据库建表脚本
-- 版本: 1.0.0
-- 日期: 2026-03-18
-- 数据库: MySQL 8.0+
-- 字符集: utf8mb4
-- ============================================================

-- 注意: 用户/部门/角色信息通过 Account 模块 API 获取，本模块仅保存标识作为引用
-- 标识通常为字符串 (uid, dept_code, resource_code)

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- 创建数据库
CREATE DATABASE IF NOT EXISTS `hzy_workflow` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `hzy_workflow`;

-- -----------------------------------------------------------
-- 1. 审批流程定义表
-- -----------------------------------------------------------
DROP TABLE IF EXISTS `flow_schemas`;
CREATE TABLE `flow_schemas` (
    `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY COMMENT '主键',
    `code` VARCHAR(50) NOT NULL UNIQUE COMMENT '流程编码，如 sequential_2level、committee_vote',
    `name` VARCHAR(100) NOT NULL COMMENT '显示名称，如"两级审批"、"委员会表决"',
    `description` VARCHAR(500) NULL COMMENT '流程说明',
    `nodes` JSON NOT NULL COMMENT '审批节点数组',
    `config` JSON NULL COMMENT '流程级配置',
    `version` INT NOT NULL DEFAULT 1 COMMENT '版本号（编辑后递增，已发起的实例使用快照）',
    `status` TINYINT NOT NULL DEFAULT 1 COMMENT '状态: 1=启用 0=禁用',
    `is_template` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否为系统模板（1=模板，0=业务流程）',
    `created_by` VARCHAR(50) NOT NULL COMMENT '创建人 UID',
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='审批流程定义表';

-- -----------------------------------------------------------
-- 2. 动态表单定义表
-- -----------------------------------------------------------
DROP TABLE IF EXISTS `form_schemas`;
CREATE TABLE `form_schemas` (
    `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY COMMENT '主键',
    `code` VARCHAR(50) NOT NULL UNIQUE COMMENT '表单编码，如 document_publish_form',
    `name` VARCHAR(100) NOT NULL COMMENT '表单名称',
    `description` VARCHAR(500) NULL COMMENT '表单说明',
    `fields` JSON NOT NULL COMMENT '字段定义数组',
    `version` INT NOT NULL DEFAULT 1 COMMENT '版本号',
    `status` TINYINT NOT NULL DEFAULT 1 COMMENT '状态: 1=启用 0=禁用',
    `created_by` VARCHAR(50) NOT NULL COMMENT '创建人 UID',
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='动态表单定义表';

-- -----------------------------------------------------------
-- 3. 资源动作定义表
-- -----------------------------------------------------------
DROP TABLE IF EXISTS `flow_action_defs`;
CREATE TABLE `flow_action_defs` (
    `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY COMMENT '主键',
    `app_code` VARCHAR(50) NOT NULL COMMENT '应用编码（对应 account.applications.app_code），如 codocs',
    `resource_code` VARCHAR(50) NOT NULL COMMENT '资源编码（对应 account.resources.resource_code），如 documents',
    `action_code` VARCHAR(50) NOT NULL COMMENT '动作编码，如 publish、archive',
    `name` VARCHAR(100) NOT NULL COMMENT '动作名称，如"发文审批"、"归档审批"',
    `description` VARCHAR(500) NULL COMMENT '动作说明',
    `form_schema_id` BIGINT UNSIGNED NULL COMMENT '关联的表单定义（NULL 表示无需额外表单）',
    `icon` VARCHAR(100) NULL COMMENT '图标名称（Nuxt UI 图标）',
    `embed_url_pattern` VARCHAR(500) NULL COMMENT '业务详情嵌入URL模式，变量：{app_base_url} {resource_code} {biz_id}',
    `sort_order` INT NOT NULL DEFAULT 0 COMMENT '排序序号',
    `status` TINYINT NOT NULL DEFAULT 1 COMMENT '状态: 1=启用 0=禁用',
    `source` ENUM('manual', 'sync') NOT NULL DEFAULT 'manual' COMMENT '来源：manual=手动创建, sync=应用自动同步',
    `created_by` VARCHAR(50) NOT NULL COMMENT '创建人 UID',
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    UNIQUE KEY `uk_app_resource_action` (`app_code`, `resource_code`, `action_code`),
    CONSTRAINT `fk_action_defs_form_schema` FOREIGN KEY (`form_schema_id`) REFERENCES `form_schemas`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='资源动作定义表';

-- -----------------------------------------------------------
-- 4. 流程路由规则表
-- -----------------------------------------------------------
DROP TABLE IF EXISTS `flow_routes`;
CREATE TABLE `flow_routes` (
    `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY COMMENT '主键',
    `action_def_id` BIGINT UNSIGNED NOT NULL COMMENT '关联 flow_action_defs.id',
    `flow_schema_id` BIGINT UNSIGNED NOT NULL COMMENT '匹配命中时使用的审批流程',
    `name` VARCHAR(100) NOT NULL COMMENT '规则名称，如"委员会发文走表决流程"',
    `description` VARCHAR(500) NULL COMMENT '规则说明',
    `level` TINYINT UNSIGNED NULL COMMENT '评审级别: NULL=不按级别匹配, 0=免评审, 1=一般, 2=重要, 3=重大, 4=关键',
    `conditions` JSON NULL COMMENT '匹配条件',
    `priority` INT NOT NULL DEFAULT 0 COMMENT '优先级（数值越大越优先匹配）',
    `is_default` TINYINT NOT NULL DEFAULT 0 COMMENT '是否为兜底规则（无条件匹配）',
    `status` TINYINT NOT NULL DEFAULT 1 COMMENT '状态: 1=启用 0=禁用',
    `created_by` VARCHAR(50) NOT NULL COMMENT '创建人 UID',
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    UNIQUE KEY `uk_action_level` (`action_def_id`, `level`),
    CONSTRAINT `fk_routes_action_def` FOREIGN KEY (`action_def_id`) REFERENCES `flow_action_defs`(`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_routes_flow_schema` FOREIGN KEY (`flow_schema_id`) REFERENCES `flow_schemas`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='流程路由规则表';

-- -----------------------------------------------------------
-- 5. 流程实例表
-- -----------------------------------------------------------
DROP TABLE IF EXISTS `flow_instances`;
CREATE TABLE `flow_instances` (
    `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY COMMENT '主键',
    `instance_no` VARCHAR(30) NOT NULL UNIQUE COMMENT '流程编号，如 WF202603180001（自动生成）',
    `action_def_id` BIGINT UNSIGNED NOT NULL COMMENT '关联动作定义',
    `route_id` BIGINT UNSIGNED NOT NULL COMMENT '实际匹配的路由规则',
    `flow_schema_id` BIGINT UNSIGNED NOT NULL COMMENT '冗余：实际使用的流程定义',
    `app_code` VARCHAR(50) NOT NULL COMMENT '冗余：应用编码',
    `resource_code` VARCHAR(50) NOT NULL COMMENT '冗余：资源编码',
    `action_code` VARCHAR(50) NOT NULL COMMENT '冗余：动作编码',
    `biz_id` VARCHAR(100) NOT NULL COMMENT '业务主键（如 document UUID、contract ID）',
    `biz_title` VARCHAR(255) NOT NULL COMMENT '冗余：业务标题（如"《XX制度》发文审批"）',
    `biz_url` VARCHAR(500) NULL COMMENT '业务详情页 URL（审批人可点击查看原始业务数据）',
    `biz_context` JSON NULL COMMENT '发起时的上下文快照（部门信息、角色等，用于路由和审批人解析）',
    `form_data` JSON NULL COMMENT '申请人填写的表单数据',
    `attachments` JSON NULL COMMENT '附件列表',
    `initiator_uid` VARCHAR(50) NOT NULL COMMENT '发起人 UID',
    `status` ENUM('running','approved','rejected','cancelled','suspended') NOT NULL DEFAULT 'running' COMMENT '流程状态',
    `current_node` INT NOT NULL DEFAULT 0 COMMENT '当前审批节点序号',
    `flow_snapshot` JSON NOT NULL COMMENT '发起时的完整流程快照（含解析后的具体审批人）',
    `callback_url` VARCHAR(500) NULL COMMENT '流程结束时回调业务模块的 URL',
    `completed_at` DATETIME NULL COMMENT '流程完成时间',
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    INDEX `idx_initiator_status` (`initiator_uid`, `status`),
    INDEX `idx_resource_action` (`resource_code`, `action_code`),
    INDEX `idx_biz_key` (`app_code`, `resource_code`, `biz_id`, `action_code`, `status`),
    INDEX `idx_initiator_app` (`initiator_uid`, `app_code`, `status`, `created_at`),
    INDEX `idx_status_created` (`status`, `created_at`),
    CONSTRAINT `fk_instances_action_def` FOREIGN KEY (`action_def_id`) REFERENCES `flow_action_defs`(`id`),
    CONSTRAINT `fk_instances_route` FOREIGN KEY (`route_id`) REFERENCES `flow_routes`(`id`),
    CONSTRAINT `fk_instances_flow_schema` FOREIGN KEY (`flow_schema_id`) REFERENCES `flow_schemas`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='流程实例表';

-- -----------------------------------------------------------
-- 6. 待办任务表
-- -----------------------------------------------------------
DROP TABLE IF EXISTS `flow_tasks`;
CREATE TABLE `flow_tasks` (
    `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY COMMENT '主键',
    `instance_id` BIGINT UNSIGNED NOT NULL COMMENT '关联流程实例',
    `node_index` INT NOT NULL COMMENT '节点序号（对应 flow_snapshot.nodes 数组下标）',
    `node_name` VARCHAR(100) NOT NULL COMMENT '冗余：节点名称',
    `assignee_uid` VARCHAR(50) NOT NULL COMMENT '办理人 UID',
    `task_type` ENUM('approve','cc','countersign') NOT NULL COMMENT '任务类型：审批/抄送/会签',
    `status` ENUM('pending','completed','skipped','cancelled') NOT NULL DEFAULT 'pending' COMMENT '任务状态',
    `due_at` DATETIME NULL COMMENT '截止时间（可选，用于催办和超时处理）',
    `completed_at` DATETIME NULL COMMENT '完成时间',
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    INDEX `idx_assignee_status` (`assignee_uid`, `status`),
    INDEX `idx_instance_node` (`instance_id`, `node_index`),
    INDEX `idx_status_created` (`status`, `created_at`),
    CONSTRAINT `fk_tasks_instance` FOREIGN KEY (`instance_id`) REFERENCES `flow_instances`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='待办任务表';

-- -----------------------------------------------------------
-- 7. 操作记录表
-- -----------------------------------------------------------
DROP TABLE IF EXISTS `flow_actions`;
CREATE TABLE `flow_actions` (
    `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY COMMENT '主键',
    `instance_id` BIGINT UNSIGNED NOT NULL COMMENT '关联流程实例（冗余，方便查询）',
    `task_id` BIGINT UNSIGNED NULL COMMENT '关联任务（resubmit/cancel/remind 等实例级操作可为空）',
    `actor_uid` VARCHAR(50) NOT NULL COMMENT '操作人 UID',
    `action` ENUM('approve','reject','delegate','withdraw','remind','resubmit') NOT NULL COMMENT '操作类型',
    `comment` TEXT NULL COMMENT '审批意见',
    `attachments` JSON NULL COMMENT '审批时追加的附件',
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '操作时间',

    INDEX `idx_instance` (`instance_id`, `created_at`),
    INDEX `idx_actor` (`actor_uid`, `created_at`),
    CONSTRAINT `fk_actions_instance` FOREIGN KEY (`instance_id`) REFERENCES `flow_instances`(`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_actions_task` FOREIGN KEY (`task_id`) REFERENCES `flow_tasks`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='操作记录表';

SET FOREIGN_KEY_CHECKS = 1;

-- ============================================================
-- 种子数据
-- ============================================================

-- -----------------------------------------------------------
-- 流程定义种子数据
-- -----------------------------------------------------------

-- 三级审批流程
INSERT INTO `flow_schemas` (`code`, `name`, `description`, `nodes`, `config`, `version`, `status`, `created_by`) VALUES
('sequential_3level', '三级审批', '依次经过直属上级、部门负责人、分管领导三级审批', JSON_ARRAY(
    JSON_OBJECT('name', '直属上级审批', 'type', 'approve', 'approve_mode', 'any', 'assignees', JSON_ARRAY(
        JSON_OBJECT('type', 'initiator_leader')
    )),
    JSON_OBJECT('name', '部门负责人审批', 'type', 'approve', 'approve_mode', 'any', 'assignees', JSON_ARRAY(
        JSON_OBJECT('type', 'dept_manager', 'scope', 'initiator_dept')
    ), 'skip_when', JSON_OBJECT('initiator_role', 'dept_manager')),
    JSON_OBJECT('name', '分管领导审批', 'type', 'approve', 'approve_mode', 'any', 'assignees', JSON_ARRAY(
        JSON_OBJECT('type', 'dept_leader', 'scope', 'initiator_dept')
    ))
), JSON_OBJECT('allow_withdraw', true, 'allow_resubmit', true, 'reject_strategy', 'to_initiator'), 1, 1, 'admin');

-- 两级审批流程
INSERT INTO `flow_schemas` (`code`, `name`, `description`, `nodes`, `config`, `version`, `status`, `created_by`) VALUES
('sequential_2level', '两级审批', '依次经过部门负责人、分管领导两级审批', JSON_ARRAY(
    JSON_OBJECT('name', '部门负责人审批', 'type', 'approve', 'approve_mode', 'any', 'assignees', JSON_ARRAY(
        JSON_OBJECT('type', 'dept_manager', 'scope', 'initiator_dept')
    )),
    JSON_OBJECT('name', '分管领导审批', 'type', 'approve', 'approve_mode', 'any', 'assignees', JSON_ARRAY(
        JSON_OBJECT('type', 'dept_leader', 'scope', 'initiator_dept')
    ))
), JSON_OBJECT('allow_withdraw', true, 'allow_resubmit', true, 'reject_strategy', 'to_initiator'), 1, 1, 'admin');

-- 委员会表决流程
INSERT INTO `flow_schemas` (`code`, `name`, `description`, `nodes`, `config`, `version`, `status`, `created_by`) VALUES
('committee_vote', '委员会表决', '委员会成员会签后由委员会主任确认', JSON_ARRAY(
    JSON_OBJECT('name', '委员会成员会签', 'type', 'countersign', 'approve_mode', 'all', 'assignees', JSON_ARRAY(
        JSON_OBJECT('type', 'role', 'code', 'committee_member', 'scope', 'resource_dept')
    )),
    JSON_OBJECT('name', '委员会主任确认', 'type', 'approve', 'approve_mode', 'any', 'assignees', JSON_ARRAY(
        JSON_OBJECT('type', 'dept_manager', 'scope', 'resource_dept')
    ))
), JSON_OBJECT('allow_withdraw', false, 'allow_resubmit', true, 'reject_strategy', 'to_initiator'), 1, 1, 'admin');

-- -----------------------------------------------------------
-- 表单定义种子数据
-- -----------------------------------------------------------

-- 发文申请表单
INSERT INTO `form_schemas` (`code`, `name`, `description`, `fields`, `version`, `status`, `created_by`) VALUES
('document_publish_form', '发文申请表单', '文档发布审批时需要填写的表单', JSON_ARRAY(
    JSON_OBJECT('key', 'title', 'label', '文档标题', 'type', 'text', 'required', true, 'readonly', true, 'source', 'biz', 'description', '来自业务数据，不可修改'),
    JSON_OBJECT('key', 'urgency', 'label', '紧急程度', 'type', 'select', 'required', true, 'options', JSON_ARRAY(
        JSON_OBJECT('label', '普通', 'value', 'normal'),
        JSON_OBJECT('label', '紧急', 'value', 'urgent'),
        JSON_OBJECT('label', '特急', 'value', 'critical')
    ), 'default', 'normal'),
    JSON_OBJECT('key', 'target_category', 'label', '发文范围', 'type', 'select', 'required', true, 'options', JSON_ARRAY(
        JSON_OBJECT('label', '全员', 'value', 'all'),
        JSON_OBJECT('label', '部门内部', 'value', 'department'),
        JSON_OBJECT('label', '指定人员', 'value', 'specific')
    )),
    JSON_OBJECT('key', 'reason', 'label', '发文说明', 'type', 'textarea', 'required', false, 'placeholder', '请简要说明发文原因和目的')
), 1, 1, 'admin');

-- -----------------------------------------------------------
-- 资源动作定义种子数据
-- -----------------------------------------------------------

-- 文档发布动作
INSERT INTO `flow_action_defs` (`app_code`, `resource_code`, `action_code`, `name`, `description`, `form_schema_id`, `icon`, `sort_order`, `status`, `created_by`) VALUES
('codocs', 'documents', 'publish', '发文审批', '文档发布需要经过审批流程', (SELECT `id` FROM `form_schemas` WHERE `code` = 'document_publish_form'), 'i-heroicons-document-arrow-up', 1, 1, 'admin');

-- -----------------------------------------------------------
-- 流程路由规则种子数据
-- -----------------------------------------------------------

-- 委员会发文走表决流程（高优先级条件路由）
INSERT INTO `flow_routes` (`action_def_id`, `flow_schema_id`, `name`, `description`, `conditions`, `priority`, `is_default`, `status`, `created_by`) VALUES
(
    (SELECT `id` FROM `flow_action_defs` WHERE `app_code` = 'codocs' AND `resource_code` = 'documents' AND `action_code` = 'publish'),
    (SELECT `id` FROM `flow_schemas` WHERE `code` = 'committee_vote'),
    '委员会发文走表决流程',
    '当发起人所在部门为委员会类型时，走委员会表决流程',
    JSON_OBJECT('dept_org_type', 'committee'),
    100,
    0,
    1,
    'admin'
);

-- 默认发文走三级审批（兜底规则）
INSERT INTO `flow_routes` (`action_def_id`, `flow_schema_id`, `name`, `description`, `conditions`, `priority`, `is_default`, `status`, `created_by`) VALUES
(
    (SELECT `id` FROM `flow_action_defs` WHERE `app_code` = 'codocs' AND `resource_code` = 'documents' AND `action_code` = 'publish'),
    (SELECT `id` FROM `flow_schemas` WHERE `code` = 'sequential_3level'),
    '默认发文走三级审批',
    '无特殊条件时，发文默认走三级审批流程',
    NULL,
    0,
    1,
    1,
    'admin'
);

-- ============================================================
-- 回调日志表
-- ============================================================

CREATE TABLE IF NOT EXISTS `flow_callback_logs` (
    `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `instance_id` BIGINT UNSIGNED NOT NULL COMMENT '流程实例ID',
    `callback_url` VARCHAR(500) NOT NULL COMMENT '回调地址',
    `event` VARCHAR(50) NOT NULL COMMENT '事件类型',
    `status` ENUM('success', 'failed', 'pending') NOT NULL DEFAULT 'pending' COMMENT '回调状态',
    `attempts` INT NOT NULL DEFAULT 0 COMMENT '尝试次数',
    `last_error` TEXT NULL COMMENT '最后一次错误信息',
    `payload` JSON NULL COMMENT '回调payload',
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX `idx_instance` (`instance_id`),
    INDEX `idx_status` (`status`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='流程回调日志';
