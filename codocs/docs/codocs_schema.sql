-- ============================================================
-- Codocs 文档协同系统 - 数据库建表脚本
-- 版本: 1.2.0
-- 日期: 2026-03-12
-- 数据库: MySQL 8.0+
-- 字符集: utf8mb4
-- ============================================================

-- 注意: 用户/部门/项目信息通过 Account 模块 API 获取，本模块仅保存标识作为引用
-- 标识通常为字符串 (uid, dept_code, project_code)
-- 重要: project_code 字段不使用外键约束，因为 git_projects 表在 account 模块的数据库中

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- 创建数据库
CREATE DATABASE IF NOT EXISTS `hzy_codocs` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `hzy_codocs`;

-- -----------------------------------------------------------
-- 1. 项目表 (冗余存储，主要通过 API 获取)
-- -----------------------------------------------------------
DROP TABLE IF EXISTS `git_projects`;
CREATE TABLE `git_projects` (
    `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY COMMENT '自增ID',
    `project_code` VARCHAR(100) NOT NULL UNIQUE COMMENT '项目唯一标识符(字符串)',
    `name` VARCHAR(100) NOT NULL COMMENT '项目名称',
    `description` VARCHAR(500) NULL COMMENT '项目描述',
    `owner_uid` VARCHAR(64) NOT NULL COMMENT '项目负责人用户名(Account)',
    `status` TINYINT NOT NULL DEFAULT 1 COMMENT '状态: 1-进行中 2-已完成 0-已发布',
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    INDEX `idx_projects_owner` (`owner_uid`),
    INDEX `idx_projects_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='项目表';

-- -----------------------------------------------------------
-- 2. 项目成员表
-- -----------------------------------------------------------
DROP TABLE IF EXISTS `git_project_members`;
CREATE TABLE `git_project_members` (
    `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY COMMENT 'ID',
    `project_code` VARCHAR(64) NOT NULL COMMENT '项目ID',
    `member_uid` VARCHAR(64) NOT NULL COMMENT '成员用户名(Account)',
    `role` ENUM('owner', 'admin', 'editor', 'viewer') NOT NULL DEFAULT 'editor' COMMENT '角色',
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '加入时间',

    UNIQUE KEY `uk_project_member` (`project_code`, `member_uid`),
    INDEX `idx_pm_member` (`member_uid`)
    -- 注意: project_code 不使用外键约束，因为 git_projects 表在 account 模块的数据库中
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='项目成员表';

-- -----------------------------------------------------------
-- 3. 文件夹表
-- -----------------------------------------------------------
DROP TABLE IF EXISTS `folders`;
CREATE TABLE `folders` (
    `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY COMMENT '文件夹ID',
    `name` VARCHAR(100) NOT NULL COMMENT '文件夹名称',
    `folder_type` ENUM('private', 'slide', 'department', 'project', 'publish') NOT NULL COMMENT '文件夹类型',
    `owner_uid` VARCHAR(64) NULL COMMENT '所有者用户名(私有文件夹)',
    `dept_code` VARCHAR(64) NULL COMMENT '所属部门编码(Account)',
    `project_code` VARCHAR(64) NULL COMMENT '所属项目编码',
    `parent_id` BIGINT UNSIGNED NULL COMMENT '父文件夹ID',
    `sort_order` INT NOT NULL DEFAULT 0 COMMENT '排序序号',
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    INDEX `idx_folders_owner` (`owner_uid`),
    INDEX `idx_folders_department` (`dept_code`),
    INDEX `idx_folders_project` (`project_code`),
    INDEX `idx_folders_parent` (`parent_id`),
    CONSTRAINT `fk_folders_parent` FOREIGN KEY (`parent_id`) REFERENCES `folders`(`id`) ON DELETE CASCADE
    -- 注意: project_code 不使用外键约束，因为 git_projects 表在 account 模块的数据库中
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='文件夹表';

-- -----------------------------------------------------------
-- 4. 文档表
-- -----------------------------------------------------------
DROP TABLE IF EXISTS `documents`;
CREATE TABLE `documents` (
    `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY COMMENT '文档ID',
    `uuid` CHAR(36) NOT NULL COMMENT '文档UUID(用于外部访问)',
    `title` VARCHAR(255) NOT NULL COMMENT '文档标题',
    `doc_type` ENUM('private', 'slide', 'shared', 'department', 'project', 'git-project', 'company', 'knowledge', 'product', 'sale') NOT NULL COMMENT '文档类型',
    `oss_path` VARCHAR(500) NOT NULL COMMENT 'OSS存储路径',
    `owner_uid` VARCHAR(64) NOT NULL COMMENT '所有者用户名(Account)',
    `dept_code` VARCHAR(100) NULL COMMENT '所属部门编码(Account)',
    `project_code` VARCHAR(100) NULL COMMENT '所属项目编码',
    `folder_id` BIGINT UNSIGNED NULL COMMENT '所属文件夹ID',
    `star_flag` TINYINT NOT NULL DEFAULT 0 COMMENT '收藏标志: 0-未收藏 1-已收藏',
    `home_flag` TINYINT NOT NULL DEFAULT 0 COMMENT '首页标志: 0-不展示 1-展示',
    `readonly_flag` TINYINT NOT NULL DEFAULT 0 COMMENT '只读标志: 0-可编辑 1-只读',
    `publish_info` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '已发布标记: 已发布为XXX',
    `ai_abstract` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'AI摘要',
    `status` TINYINT NOT NULL DEFAULT 1 COMMENT '状态: 1-正常 0-已删除 2-已发布',
    `content_size` INT UNSIGNED DEFAULT 0 COMMENT '内容大小(字节)',
    `last_editor_uid` VARCHAR(64) NULL COMMENT '最后编辑者用户名',
    `oss_commit_id` VARCHAR(64) NULL COMMENT 'OSS提交ID',
    `diff` TEXT NULL COMMENT '差异',
    `committed_at` DATETIME NULL COMMENT '提交时间',
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    `deleted_at` DATETIME NULL COMMENT '删除时间(软删除)',

    UNIQUE KEY `uk_documents_uuid` (`uuid`),
    INDEX `idx_documents_owner` (`owner_uid`),
    INDEX `idx_documents_department` (`dept_code`),
    INDEX `idx_documents_project` (`project_code`),
    INDEX `idx_documents_folder` (`folder_id`),
    INDEX `idx_documents_type_status` (`doc_type`, `status`),
    INDEX `idx_documents_deleted` (`deleted_at`),
    -- 注意: project_code 不使用外键约束，因为 git_projects 表在 account 模块的数据库中
    CONSTRAINT `fk_documents_folder` FOREIGN KEY (`folder_id`) REFERENCES `folders`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='文档表';

-- -----------------------------------------------------------
-- 5. 文档权限表
-- -----------------------------------------------------------
DROP TABLE IF EXISTS `document_permissions`;
CREATE TABLE `document_permissions` (
    `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY COMMENT 'ID',
    `document_id` BIGINT UNSIGNED NOT NULL COMMENT '文档ID',
    `grantee_type` ENUM('user', 'department', 'project', 'all') NOT NULL COMMENT '授权对象类型',
    `grantee_id` VARCHAR(64) NOT NULL COMMENT '授权对象ID(用户名/部门ID/项目ID/*)',
    `permission` ENUM('owner', 'editor', 'viewer') NOT NULL COMMENT '权限级别',
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '授权时间',
    `expires_at` DATETIME NULL COMMENT '过期时间(可选)',

    UNIQUE KEY `uk_doc_permission` (`document_id`, `grantee_type`, `grantee_id`),
    INDEX `idx_dp_grantee` (`grantee_type`, `grantee_id`),
    CONSTRAINT `fk_dp_document` FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='文档权限表';

-- -----------------------------------------------------------
-- 6. 文档共享记录表
-- -----------------------------------------------------------
DROP TABLE IF EXISTS `document_shares`;
CREATE TABLE `document_shares` (
    `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY COMMENT '共享ID',
    `document_id` BIGINT UNSIGNED NOT NULL COMMENT '文档ID',
    `owner_uid` VARCHAR(64) NOT NULL COMMENT '共享者用户名(Account)',
    `shared_to_uid` VARCHAR(64) NOT NULL COMMENT '被共享人用户名(Account)',
    `permission` ENUM('read', 'write') NOT NULL DEFAULT 'read' COMMENT '权限: read-只读 write-读写',
    `message` VARCHAR(500) NULL COMMENT '附言',
    `is_opened` TINYINT NOT NULL DEFAULT 0 COMMENT '是否已打开: 0-未读 1-已读',
    `opened_at` DATETIME NULL COMMENT '首次打开时间',
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '共享时间',
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    INDEX `idx_shares_doc` (`document_id`),
    INDEX `idx_shares_to` (`shared_to_uid`),
    INDEX `idx_shares_owner` (`owner_uid`),
    UNIQUE KEY `uk_shares_user` (`document_id`, `shared_to_uid`),
    CONSTRAINT `fk_shares_document` FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='文档共享记录表';

-- -----------------------------------------------------------
-- 6.1 文档关系统一索引表
-- -----------------------------------------------------------
DROP TABLE IF EXISTS `document_relations`;
CREATE TABLE `document_relations` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
    `document_id` BIGINT UNSIGNED NOT NULL COMMENT '文档ID',
    `document_uuid` VARCHAR(36) NOT NULL COMMENT '文档UUID',
    `related_uid` VARCHAR(64) NOT NULL COMMENT '关联用户UID',
    `relation_type` VARCHAR(50) NOT NULL COMMENT '关系类型',
    `source_type` VARCHAR(50) NOT NULL COMMENT '来源类型',
    `source_id` VARCHAR(100) DEFAULT NULL COMMENT '来源ID',
    `source_dept_code` VARCHAR(50) DEFAULT NULL COMMENT '来源部门',
    `can_read` TINYINT NOT NULL DEFAULT 1 COMMENT '可读',
    `can_edit` TINYINT NOT NULL DEFAULT 0 COMMENT '可编辑',
    `can_comment` TINYINT NOT NULL DEFAULT 0 COMMENT '可评论',
    `status` TINYINT NOT NULL DEFAULT 1 COMMENT '状态',
    `metadata` JSON DEFAULT NULL COMMENT '扩展信息',
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_relation` (`document_id`, `related_uid`, `relation_type`, `source_type`, `source_id`),
    KEY `idx_related_uid` (`related_uid`, `status`, `updated_at`),
    KEY `idx_document_uuid` (`document_uuid`, `status`),
    KEY `idx_source` (`source_type`, `source_id`, `status`),
    CONSTRAINT `fk_document_relations_document` FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='文档关系统一索引表';

-- -----------------------------------------------------------
-- 7. 文档版本表
-- -----------------------------------------------------------
DROP TABLE IF EXISTS `document_versions`;
CREATE TABLE `document_versions` (
    `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY COMMENT '版本ID',
    `document_id` BIGINT UNSIGNED NOT NULL COMMENT '文档ID',
    `version_num` INT NOT NULL COMMENT '版本号',
    `oss_version_id` VARCHAR(100) NOT NULL COMMENT 'OSS版本ID',
    `editor_uid` VARCHAR(64) NOT NULL COMMENT '编辑者用户名(Account)',
    `change_summary` VARCHAR(255) NULL COMMENT '变更摘要',
    `content_size` INT UNSIGNED DEFAULT 0 COMMENT '内容大小(字节)',
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',

    UNIQUE KEY `uk_doc_version` (`document_id`, `version_num`),
    INDEX `idx_dv_editor` (`editor_uid`),
    CONSTRAINT `fk_dv_document` FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='文档版本表';

-- -----------------------------------------------------------
-- 7.1 文档访问策略表（跨项目组访问控制）
-- -----------------------------------------------------------
DROP TABLE IF EXISTS `document_access_policies`;
CREATE TABLE `document_access_policies` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY COMMENT '主键',
  `document_ref_type` ENUM('codocs_document', 'cabinet_file') NOT NULL COMMENT '文档引用类型',
  `document_uuid` CHAR(36) NOT NULL COMMENT '文档 UUID（codocs 文档或文件柜文件）',
  `source_app` VARCHAR(32) NOT NULL DEFAULT 'aims' COMMENT '来源应用',
  `source_project_code` VARCHAR(100) NULL COMMENT '来源项目编码',
  `lifecycle_stage` ENUM('draft', 'formal', 'archived') NOT NULL DEFAULT 'draft' COMMENT '生命周期阶段',
  `confidentiality_level` ENUM('L0', 'L1', 'L2', 'L3') NOT NULL DEFAULT 'L2' COMMENT '密级',
  `default_permission` ENUM('none', 'view', 'download') NOT NULL DEFAULT 'none' COMMENT '默认权限',
  `allow_internal_access` TINYINT NOT NULL DEFAULT 0 COMMENT '是否允许企业内部访问',
  `allow_cross_project` TINYINT NOT NULL DEFAULT 0 COMMENT '是否允许跨项目组授权',
  `readonly` TINYINT NOT NULL DEFAULT 0 COMMENT '是否只读',
  `created_by` VARCHAR(64) NOT NULL COMMENT '创建人',
  `updated_by` VARCHAR(64) NOT NULL COMMENT '更新人',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

  UNIQUE KEY `uk_document_access_policy` (`document_ref_type`, `document_uuid`),
  INDEX `idx_document_access_source_project` (`source_project_code`),
  INDEX `idx_document_access_level_stage` (`confidentiality_level`, `lifecycle_stage`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='文档访问策略表';

-- -----------------------------------------------------------
-- 7.2 文档访问授权表（白名单）
-- -----------------------------------------------------------
DROP TABLE IF EXISTS `document_access_grants`;
CREATE TABLE `document_access_grants` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY COMMENT '主键',
  `policy_id` BIGINT UNSIGNED NOT NULL COMMENT '策略 ID',
  `subject_type` ENUM('project', 'dept', 'user', 'role') NOT NULL COMMENT '授权对象类型',
  `subject_code` VARCHAR(100) NOT NULL COMMENT '授权对象编码',
  `permission` ENUM('view', 'download', 'edit') NOT NULL DEFAULT 'view' COMMENT '授权权限',
  `expires_at` DATETIME NULL COMMENT '过期时间',
  `created_by` VARCHAR(64) NOT NULL COMMENT '授权人',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',

  INDEX `idx_policy_subject` (`policy_id`, `subject_type`, `subject_code`),
  INDEX `idx_subject` (`subject_type`, `subject_code`),
  CONSTRAINT `fk_document_access_grants_policy` FOREIGN KEY (`policy_id`) REFERENCES `document_access_policies`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='文档访问授权表';

-- -----------------------------------------------------------
-- 7.3 文档访问审计日志
-- -----------------------------------------------------------
DROP TABLE IF EXISTS `document_access_audit_logs`;
CREATE TABLE `document_access_audit_logs` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY COMMENT '主键',
  `document_ref_type` ENUM('codocs_document', 'cabinet_file') NOT NULL COMMENT '文档引用类型',
  `document_uuid` CHAR(36) NOT NULL COMMENT '文档 UUID',
  `actor_uid` VARCHAR(64) NULL COMMENT '访问用户 UID',
  `action` ENUM('view', 'download', 'edit', 'policy_update') NOT NULL COMMENT '访问动作',
  `decision` ENUM('allow', 'deny') NOT NULL COMMENT '决策结果',
  `reason` VARCHAR(100) NOT NULL COMMENT '命中规则/拒绝原因',
  `source_project_code` VARCHAR(100) NULL COMMENT '来源项目编码',
  `actor_project_codes` JSON NULL COMMENT '访问者项目/角色快照',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',

  INDEX `idx_document_access_audit_doc` (`document_ref_type`, `document_uuid`),
  INDEX `idx_document_access_audit_actor` (`actor_uid`),
  INDEX `idx_document_access_audit_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='文档访问审计日志';

-- -----------------------------------------------------------
-- 8. 文档模板表
-- -----------------------------------------------------------
DROP TABLE IF EXISTS `templates`;
CREATE TABLE `templates` (
    `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY COMMENT '模板ID',
    `name` VARCHAR(100) NOT NULL COMMENT '模板名称',
    `category` VARCHAR(50) NOT NULL COMMENT '模板分类',
    `description` VARCHAR(500) NULL COMMENT '模板描述',
    `content` TEXT NULL COMMENT '模板内容(小模板直接存储)',
    `oss_path` VARCHAR(500) NULL COMMENT 'OSS存储路径(大模板)',
    `thumbnail_url` VARCHAR(500) NULL COMMENT '缩略图URL',
    `creator_uid` VARCHAR(64) NOT NULL COMMENT '创建者用户名(Account)',
    `is_public` TINYINT NOT NULL DEFAULT 1 COMMENT '是否公开: 1-公开 0-私有',
    `use_count` INT UNSIGNED DEFAULT 0 COMMENT '使用次数',
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    INDEX `idx_templates_category` (`category`),
    INDEX `idx_templates_creator` (`creator_uid`),
    INDEX `idx_templates_public` (`is_public`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='文档模板表';

-- -----------------------------------------------------------
-- 9. 操作日志表
-- -----------------------------------------------------------
DROP TABLE IF EXISTS `operation_logs`;
CREATE TABLE `operation_logs` (
    `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY COMMENT '日志ID',
    `operator_uid` VARCHAR(64) NOT NULL COMMENT '操作者用户名(Account)',
    `action` VARCHAR(50) NOT NULL COMMENT '操作类型',
    `target_type` VARCHAR(50) NOT NULL COMMENT '操作对象类型',
    `target_id` BIGINT UNSIGNED NULL COMMENT '操作对象ID',
    `target_name` VARCHAR(255) NULL COMMENT '操作对象名称',
    `detail` JSON NULL COMMENT '操作详情(JSON)',
    `ip_address` VARCHAR(45) NULL COMMENT 'IP地址',
    `user_agent` VARCHAR(500) NULL COMMENT '用户代理',
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '操作时间',

    INDEX `idx_logs_operator` (`operator_uid`),
    INDEX `idx_logs_action` (`action`),
    INDEX `idx_logs_target` (`target_type`, `target_id`),
    INDEX `idx_logs_time` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='操作日志表';

-- -----------------------------------------------------------
-- 10. 系统设置表
-- -----------------------------------------------------------
DROP TABLE IF EXISTS `system_settings`;
CREATE TABLE `system_settings` (
    `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY COMMENT 'ID',
    `setting_key` VARCHAR(100) NOT NULL COMMENT '设置项键名',
    `setting_value` TEXT NULL COMMENT '设置项值',
    `value_type` ENUM('string', 'number', 'boolean', 'json') NOT NULL DEFAULT 'string' COMMENT '值类型',
    `description` VARCHAR(255) NULL COMMENT '设置项描述',
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    UNIQUE KEY `uk_setting_key` (`setting_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='系统设置表';

-- -----------------------------------------------------------
-- 11. 文档标注与回复表
-- -----------------------------------------------------------
DROP TABLE IF EXISTS `document_annotations`;
CREATE TABLE `document_annotations` (
    `id` INT PRIMARY KEY AUTO_INCREMENT,
    `document_uuid` VARCHAR(36) NOT NULL,

    -- 位置信息（内容锚点策略）
    `selected_text` TEXT NOT NULL COMMENT '选中的文本',
    `context_before` VARCHAR(100) NULL COMMENT '选区前的上下文',
    `context_after` VARCHAR(100) NULL COMMENT '选区后的上下文',
    `position_hint` INT NULL COMMENT '大致位置提示',

    -- 标注内容
    `content` TEXT NOT NULL COMMENT '标注内容',
    `mentioned_users` JSON NULL COMMENT '@提及的用户ID数组',

    -- 状态
    `status` ENUM('active', 'resolved', 'deleted') DEFAULT 'active',

    -- 元数据
    `author_id` VARCHAR(64) NOT NULL COMMENT '作者UID',
    `author_name` VARCHAR(100) NULL COMMENT '作者姓名',
    `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    `resolved_at` DATETIME NULL,
    `resolved_by` VARCHAR(64) NULL,
    `deleted_at` DATETIME NULL,
    `deleted_by` VARCHAR(64) NULL,

    INDEX `idx_document` (`document_uuid`),
    INDEX `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='文档标注表';

DROP TABLE IF EXISTS `annotation_replies`;
CREATE TABLE `annotation_replies` (
    `id` INT PRIMARY KEY AUTO_INCREMENT,
    `annotation_id` INT NOT NULL,
    `content` TEXT NOT NULL COMMENT '回复内容',
    `mentioned_users` JSON NULL COMMENT '@提及的用户ID数组',
    `author_id` VARCHAR(64) NOT NULL COMMENT '作者UID',
    `author_name` VARCHAR(100) NULL COMMENT '作者姓名',
    `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
    `deleted_at` DATETIME NULL,

    FOREIGN KEY (`annotation_id`) REFERENCES `document_annotations`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='标注回复表';

-- -----------------------------------------------------------
-- 12. 需求与Bug跟踪表
-- -----------------------------------------------------------
DROP TABLE IF EXISTS `project_issues`;
CREATE TABLE `project_issues` (
    `id` INT PRIMARY KEY AUTO_INCREMENT,
    `project_code` VARCHAR(64) NOT NULL COMMENT '项目编码',
    `title` VARCHAR(255) NOT NULL COMMENT '标题',
    `description` LONGTEXT COMMENT '详细描述（Markdown）',

    -- 分类与状态
    `issue_type` ENUM('bug', 'feature', 'improvement') NOT NULL DEFAULT 'bug' COMMENT '类型：缺陷/需求/改进',
    `status` ENUM('open', 'in_progress', 'resolved', 'closed', 'rejected') NOT NULL DEFAULT 'open' COMMENT '状态',
    `priority` ENUM('low', 'medium', 'high', 'critical') NOT NULL DEFAULT 'medium' COMMENT '优先级',

    -- 人员
    `created_by` VARCHAR(64) NOT NULL COMMENT '提交人UID',
    `assignee` VARCHAR(64) NULL COMMENT '负责人UID',

    -- 关联
    `document_uuid` VARCHAR(36) NULL COMMENT '关联文档UUID',
    `tags` VARCHAR(500) NULL COMMENT '标签，逗号分隔',

    -- 处理结果
    `resolution` TEXT NULL COMMENT '处理结果/关闭说明',

    -- 时间
    `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    `resolved_at` DATETIME NULL,
    `closed_at` DATETIME NULL,

    INDEX `idx_project` (`project_code`),
    INDEX `idx_status` (`status`),
    INDEX `idx_type` (`issue_type`),
    INDEX `idx_assignee` (`assignee`),
    INDEX `idx_created_by` (`created_by`),
    CONSTRAINT `fk_issues_project` FOREIGN KEY (`project_code`) REFERENCES `git_projects`(`project_code`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='项目需求与Bug跟踪表';

DROP TABLE IF EXISTS `issue_comments`;
CREATE TABLE `issue_comments` (
    `id` INT PRIMARY KEY AUTO_INCREMENT,
    `issue_id` INT NOT NULL,
    `author` VARCHAR(64) NOT NULL COMMENT '评论人UID',
    `content` TEXT NOT NULL COMMENT '评论内容',
    `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (`issue_id`) REFERENCES `project_issues`(`id`) ON DELETE CASCADE,
    INDEX `idx_issue` (`issue_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Issue 评论表';

-- -----------------------------------------------------------
-- 初始化系统设置
-- -----------------------------------------------------------
INSERT INTO `system_settings` (`setting_key`, `setting_value`, `value_type`, `description`) VALUES
('auto_save_interval', '5', 'number', '自动保存间隔(秒)'),
('recycle_bin_days', '30', 'number', '回收站保留天数'),
('ai_enabled', 'true', 'boolean', 'AI辅助功能开关'),
('max_file_size', '10485760', 'number', '单文件最大大小(字节，默认10MB)'),
('allowed_extensions', 'md,markdown', 'string', '允许的文件扩展名');

SET FOREIGN_KEY_CHECKS = 1;

-- ============================================================
-- 建表完成
-- ============================================================

-- ============================================================
-- Data Migration from hzy_codocs.sql
-- ============================================================

SET FOREIGN_KEY_CHECKS = 0;

DELETE FROM documents;
DELETE FROM folders;
DELETE FROM git_projects;

INSERT INTO folders (id, name, folder_type, owner_uid, dept_code, project_code, parent_id, sort_order, created_at, updated_at) VALUES
(1, '汇智云文档', 'private', 'zhouguangying', NULL, NULL, NULL, 0, '2026-01-21 01:33:33', '2026-01-21 08:23:33'),
(6, '项目文档', 'private', 'zhouguangying', NULL, NULL, NULL, 0, '2026-01-21 05:55:39', '2026-01-21 05:55:39'),
(21, '1', 'private', 'chenyiming', NULL, NULL, NULL, 0, '2026-03-05 18:22:03', '2026-03-05 18:22:03'),
(23, '管理文档', 'private', 'zhouguangying', NULL, NULL, NULL, 0, '2026-03-09 10:12:55', '2026-03-09 10:12:55'),
(24, '技术委员会', 'private', 'zhouguangying', NULL, NULL, NULL, 0, '2026-03-09 10:30:30', '2026-03-09 10:30:30'),
(31, '工作汇报', 'department', 'caoqian', 'RD', NULL, NULL, 0, '2026-03-11 08:47:15', '2026-03-11 08:47:15'),
(32, '部门规章', 'department', 'caoqian', 'RD', NULL, NULL, 0, '2026-03-11 08:47:31', '2026-03-11 08:47:31'),
(33, '部门模板', 'department', 'caoqian', 'RD', NULL, NULL, 0, '2026-03-11 08:47:39', '2026-03-11 08:47:39'),
(34, '部门知识库', 'department', 'caoqian', 'RD', NULL, NULL, 0, '2026-03-11 08:47:47', '2026-03-11 08:47:47'),
(35, 'AI应用月报', 'department', 'caoqian', 'RD', NULL, 31, 0, '2026-03-11 08:47:58', '2026-03-11 08:47:58'),
(36, '2026-03', 'department', 'caoqian', 'RD', NULL, 35, 0, '2026-03-11 08:48:13', '2026-03-11 08:48:13'),
(37, '测试专用文件夹', 'private', 'renjianwei', NULL, NULL, NULL, 0, '2026-03-11 10:47:06', '2026-03-11 10:47:06');

INSERT INTO documents (id, uuid, title, doc_type, oss_path, owner_uid, dept_code, project_code, folder_id, star_flag, home_flag, readonly_flag, publish_info, ai_abstract, status, content_size, last_editor_uid, created_at, updated_at, committed_at, deleted_at) VALUES
(5, '0ee5ec9f-0016-4cb3-af58-efaadc2277c0', '测试1', 'private', 'codocs/users/zhouguangying/docs/5.md', 'zhouguangying', NULL, NULL, NULL, 0, 0, 0, NULL, NULL, 0, 0, NULL, '2026-01-21 06:21:11', '2026-01-21 06:26:16', NULL, NULL),
(6, 'ed45b881-7ecc-461a-9e93-7c3858df42d7', '测试文档', 'private', 'codocs/users/zhouguangying/docs/6.md', 'zhouguangying', NULL, NULL, NULL, 0, 0, 0, NULL, NULL, 0, 19493, 'zhouguangying', '2026-01-21 06:22:51', '2026-01-31 05:45:39', NULL, '2026-01-31 05:45:39'),
(7, '0b9f5921-9b7c-472e-b612-7f06359a51ab', 'Git 提交规范指南', 'private', 'codocs/users/zhouguangying/docs/项目文档/Git_提交规范指南.md', 'zhouguangying', NULL, NULL, 6, 0, 0, 0, NULL, NULL, 1, 5865, 'zhouguangying', '2026-01-21 06:26:01', '2026-01-21 09:22:51', NULL, NULL),
(8, '41c50551-6ae3-4453-9b78-8fb9cbd313e7', '未命名文档', 'private', 'codocs/users/zhouguangying/docs/PRD1.md', 'zhouguangying', NULL, NULL, NULL, 1, 1, 0, NULL, NULL, 0, 0, 'zhouguangying', '2026-01-21 07:38:51', '2026-01-25 09:46:49', NULL, '2026-01-25 09:46:49'),
(9, 'e84f63d3-3b6f-4920-8808-6790aeff0a92', 'DB-Design', 'private', 'codocs/users/zhouguangying/docs/项目文档/DB-Design.md', 'zhouguangying', NULL, NULL, 6, 0, 0, 0, NULL, NULL, 0, 316, 'zhouguangying', '2026-01-21 07:49:09', '2026-03-09 10:15:15', NULL, '2026-03-09 10:15:15'),
(10, '783f7157-9c6d-4120-aa8e-24b12307fed4', '测试', 'private', 'codocs/users/zhouguangying/docs/测试2_783f7157.md', 'zhouguangying', NULL, NULL, NULL, 0, 0, 0, NULL, NULL, 0, 0, NULL, '2026-01-21 07:50:08', '2026-01-31 05:45:32', NULL, '2026-01-31 05:45:32'),
(11, '96a00339-f336-4736-8394-53d69471370c', '测试6', 'private', 'codocs/users/zhouguangying/docs/测试6.md', 'zhouguangying', NULL, NULL, NULL, 0, 0, 0, NULL, NULL, 0, 882, 'zhouguangying', '2026-01-21 07:56:22', '2026-02-06 20:33:06', NULL, '2026-02-06 20:33:06'),
(12, 'a35edc31-fd4d-4134-a292-d086413bfb37', '汇智云文档', 'private', 'codocs/users/zhouguangying/docs/汇智云文档/汇智云.md', 'zhouguangying', NULL, NULL, 1, 0, 0, 0, NULL, NULL, 1, 136, 'zhouguangying', '2026-01-21 08:22:46', '2026-03-09 02:06:31', NULL, NULL),
(13, 'c05cf63c-6aa0-4c36-bc6d-fd8abb4fcb33', '1需求文档', 'private', 'codocs/users/zhouguangying/docs/1需求文档.md', 'zhouguangying', NULL, NULL, NULL, 0, 0, 0, NULL, NULL, 0, 5180, 'zhouguangying', '2026-01-21 08:36:29', '2026-03-09 10:16:23', NULL, '2026-03-09 10:16:23'),
(14, 'f0ee53bc-554b-4e68-9cee-bde8e174b479', '2.2系统架构方案', 'private', 'codocs/users/zhouguangying/docs/2.2系统架构方案.md', 'zhouguangying', NULL, NULL, NULL, 0, 0, 0, NULL, NULL, 0, 18612, 'zhouguangying', '2026-01-21 08:37:28', '2026-03-09 10:16:53', NULL, '2026-03-09 10:16:53'),
(15, '52f656e4-66bc-4180-8e6f-337e6f0ea018', '2.1架构决策记录-***', 'private', 'codocs/users/zhouguangying/docs/项目文档/2.1架构决策记录-___.md', 'zhouguangying', NULL, NULL, 6, 0, 0, 0, NULL, NULL, 1, 322, NULL, '2026-01-21 08:37:30', '2026-03-09 10:17:57', NULL, NULL),
(16, '4b6d7544-6047-4274-b9b9-7e84dfd04fd0', '未命名文档', 'private', 'codocs/users/zhouguangying/docs/部门职责说明书2026.md', 'zhouguangying', NULL, NULL, NULL, 0, 1, 0, NULL, NULL, 0, 73, 'zhouguangying', '2026-01-22 22:26:26', '2026-02-06 20:33:02', NULL, '2026-02-06 20:33:02'),
(17, 'e547fe04-d513-402e-9445-d375d04c058e', '4.1用户操作手册', 'private', 'codocs/users/test/docs/4.1用户操作手册.md', 'test', NULL, NULL, NULL, 0, 1, 0, NULL, NULL, 1, 1970, 'test', '2026-01-23 04:22:07', '2026-01-23 11:22:24', NULL, NULL),
(178, 'dae23b2f-1400-4496-8fc7-c2999bfa53ad', 'Huizhi-yun-PRD', 'private', 'codocs/users/zhouguangying/docs/Huizhi-yun-PRD.md', 'zhouguangying', NULL, NULL, NULL, 0, 0, 0, NULL, NULL, 0, 10873, NULL, '2026-01-27 04:37:13', '2026-02-25 19:45:32', NULL, '2026-02-25 19:45:32'),
(179, 'ce67994d-b364-4b83-9d20-60af03e07f3c', '1需求文档', 'private', 'codocs/users/zhouguangying/docs/项目文档/1需求文档.md', 'zhouguangying', NULL, NULL, 6, 0, 0, 0, NULL, NULL, 1, 10873, NULL, '2026-01-27 04:38:14', '2026-03-09 10:16:00', NULL, NULL),
(180, '289066c3-23e6-4311-b3b5-2a6b247d59d9', '2.2系统架构方案', 'private', 'codocs/users/zhouguangying/docs/项目文档/2.2系统架构方案.md', 'zhouguangying', NULL, NULL, 6, 0, 0, 0, NULL, NULL, 1, 19651, NULL, '2026-01-27 04:38:43', '2026-03-09 10:16:10', NULL, NULL),
(181, '195b2176-3905-4f43-b97d-5f5771f3e90e', '关于公司组织架构调整及人员优化配置的实施方案（初稿）', 'private', 'codocs/users/zhouguangying/docs/管理文档/关于公司组织架构调整及人员优化配置的实施方案（初稿）.md', 'zhouguangying', NULL, NULL, 23, 0, 0, 0, NULL, NULL, 1, 7385, 'zhouguangying', '2026-01-27 04:41:06', '2026-03-09 10:16:35', NULL, NULL),
(182, 'faa72f6d-b8e5-4c71-b0c6-1ded16634eb5', '未命名文档', 'private', 'codocs/users/zhouguangying/docs/部门职责说明书.md', 'zhouguangying', NULL, NULL, NULL, 0, 0, 0, NULL, NULL, 0, 0, 'zhouguangying', '2026-01-27 04:41:35', '2026-02-02 02:39:45', NULL, '2026-02-02 02:39:45'),
(183, '2f5f6e38-3942-4be7-ba35-4ad37c64fd14', '软件工程的未来两年', 'private', 'codocs/users/zhouguangying/docs/软件工程的未来两年.md', 'zhouguangying', NULL, NULL, NULL, 1, 1, 0, NULL, NULL, 1, 17848, NULL, '2026-01-27 12:17:18', '2026-03-09 02:14:03', NULL, NULL),
(184, 'f206eec4-a04f-4c78-8a27-117cac199485', '测试文档', 'project', 'codocs/projects/huizhi-yun/docs/测试文档.md', 'zhouguangying', NULL, 'huizhi-yun', NULL, 0, 0, 0, NULL, NULL, 0, 0, NULL, '2026-01-28 00:08:03', '2026-01-31 05:36:12', NULL, '2026-01-31 05:36:12'),
(186, '7208fb61-c6eb-41d5-85d0-0f38cae310eb', '软件工程的未来两年', 'project', 'codocs/projects/huizhi-yun/docs/软件工程的未来两年.md', 'zhouguangying', NULL, 'huizhi-yun', NULL, 0, 0, 0, NULL, NULL, 0, 17848, NULL, '2026-01-28 04:59:59', '2026-01-31 05:32:23', NULL, '2026-01-31 05:32:23'),
(187, 'cdeaec1d-91c3-4044-a26d-62354b4b36f7', 'test', 'project', 'codocs/projects/huizhi-yun/docs/test.md', 'zhouguangying', NULL, 'huizhi-yun', NULL, 0, 0, 0, NULL, NULL, 0, 0, NULL, '2026-01-28 05:00:16', '2026-01-31 05:36:52', NULL, '2026-01-31 05:36:52'),
(188, 'afca39e0-7f24-4c81-a1ea-165bd2e6e6dd', 'test1', 'project', 'codocs/projects/huizhi-yun/docs/test1.md', 'zhouguangying', NULL, 'huizhi-yun', NULL, 0, 0, 0, NULL, NULL, 0, 0, NULL, '2026-01-28 05:01:38', '2026-01-31 05:38:08', NULL, '2026-01-31 05:38:08'),
(189, 'a9441d8c-a6ab-4a0e-a8f1-58696cf1f7c7', '点点滴滴', 'project', 'codocs/projects/huizhi-yun/docs/点点滴滴.md', 'zhouguangying', NULL, 'huizhi-yun', NULL, 0, 0, 0, NULL, NULL, 0, 0, NULL, '2026-01-28 05:37:49', '2026-01-31 03:42:35', NULL, '2026-01-31 03:42:35'),
(192, '9285952f-23b0-4fe6-a4f8-7b33cbcc47e1', '1', 'project', 'codocs/projects/huizhi-yun/docs/1.md', 'zhouguangying', NULL, 'huizhi-yun', NULL, 0, 0, 0, NULL, NULL, 0, 0, NULL, '2026-01-28 06:09:50', '2026-01-31 03:42:13', NULL, '2026-01-31 03:42:13'),
(193, 'bd74edb4-b0c8-48b7-845d-b73d9db0f89d', 'test', 'project', 'codocs/projects/account/docs/test.md', 'zhouguangying', NULL, 'account', NULL, 0, 0, 0, NULL, NULL, 1, 0, NULL, '2026-01-28 08:43:42', '2026-01-28 08:43:42', NULL, NULL),
(206, '656a7058-685f-4b6e-8db1-ca70de34749d', '关于调整2026年度绩效薪酬发放标准的通知', 'private', 'codocs/users/zhouguangying/docs/管理文档/关于调整2026年度绩效薪酬发放标准的通知.md', 'zhouguangying', NULL, NULL, 23, 0, 0, 0, NULL, NULL, 1, 2254, 'zhouguangying', '2026-01-28 11:52:00', '2026-03-09 10:16:46', NULL, NULL),
(207, '7cb8e01a-69b7-4714-b2d4-d787acb1494a', 'sss', 'project', 'codocs/projects//docs/sss.md', 'zhouguangying', NULL, NULL, NULL, 0, 0, 0, NULL, NULL, 1, 0, NULL, '2026-01-31 02:49:02', '2026-01-31 02:49:02', NULL, NULL),
(208, 'c52dd260-20cf-47d6-b80e-32563438fa42', 'tttt', 'project', 'codocs/projects/huizhi-yun/docs/tttt.md', 'zhouguangying', NULL, 'huizhi-yun', NULL, 0, 0, 0, NULL, NULL, 0, 0, NULL, '2026-01-31 02:54:58', '2026-01-31 05:38:20', NULL, '2026-01-31 05:38:20'),
(209, 'd09ae7a9-2e3a-40e4-853d-4c510019bee9', 'fgfgfgd', 'project', 'codocs/projects/huizhi-yun/docs/t1/fgfgfgd.md', 'zhouguangying', NULL, 'huizhi-yun', NULL, 0, 0, 0, NULL, NULL, 0, 0, NULL, '2026-01-31 03:03:07', '2026-01-31 03:43:17', NULL, '2026-01-31 03:43:17'),
(210, 'fdb5b930-459d-4928-a4d0-36c529ab799a', 'tttttt', 'project', 'codocs/projects/huizhi-yun/docs/yes/tttttt.md', 'zhouguangying', NULL, 'huizhi-yun', NULL, 0, 0, 0, NULL, NULL, 0, 0, NULL, '2026-01-31 05:39:32', '2026-02-25 16:23:42', NULL, '2026-02-25 16:23:42'),
(212, '9129480e-2996-4e23-842e-800532898958', 'test', 'department', 'codocs/departments/GMO/docs/测试/test.md', 'zhouguangying', 'GMO', NULL, NULL, 0, 0, 0, NULL, NULL, 0, 0, NULL, '2026-01-31 08:56:06', '2026-01-31 08:56:43', NULL, '2026-01-31 08:56:43'),
(213, '517f52b0-bb36-49c1-aa51-91db499fd4f8', '软件工程的未来两年', 'department', 'codocs/departments/GMO/docs/测试/软件工程的未来两年.md', 'zhouguangying', 'GMO', NULL, NULL, 0, 0, 1, '已发布为会议记录', NULL, 0, 17848, NULL, '2026-01-31 09:00:41', '2026-03-11 08:22:18', NULL, '2026-03-11 08:22:18'),
(214, 'b8aa42af-bc95-44c0-8c1f-95069dd0ae84', 'Copilot优化mermaid渲染记录', 'private', 'codocs/users/zhouguangying/docs/Copilot优化mermaid渲染记录.md', 'zhouguangying', NULL, NULL, NULL, 0, 0, 0, NULL, NULL, 0, 92893, 'zhouguangying', '2026-01-31 21:15:09', '2026-02-06 20:32:47', NULL, '2026-02-06 20:32:47'),
(215, 'ab7e10cc-7aca-4eea-9bbf-4a04e6358885', '部门职责说明书', 'private', 'codocs/users/zhouguangying/docs/项目文档/部门职责说明书.md', 'zhouguangying', NULL, NULL, 6, 0, 0, 0, NULL, NULL, 0, 30434, NULL, '2026-02-02 18:29:04', '2026-03-09 10:15:31', NULL, '2026-03-09 10:15:31'),
(216, 'cf12f7ea-4fd3-4fac-8055-dc002261d1e8', '部门职责说明书', 'private', 'codocs/users/zhouguangying/docs/管理文档/部门职责说明书.md', 'zhouguangying', NULL, NULL, 23, 0, 0, 0, NULL, NULL, 1, 26365, 'zhouguangying', '2026-02-06 20:38:00', '2026-03-09 10:14:58', NULL, NULL),
(217, '04d256d0-6579-4968-ada3-4afb0e4109cf', 'Huizhi-yun-PRD', 'project', 'codocs/projects/huizhi-yun/docs/Huizhi-yun-PRD.md', 'zhouguangying', NULL, 'huizhi-yun', NULL, 0, 0, 0, NULL, NULL, 1, 10873, NULL, '2026-02-25 16:36:39', '2026-02-25 16:36:39', NULL, NULL),
(218, 'b1428bee-3dc2-4aae-878f-bbda1785939e', 'deployment_guide', 'private', 'codocs/users/zhouguangying/docs/deployment_guide.md', 'zhouguangying', NULL, NULL, NULL, 0, 0, 0, NULL, NULL, 0, 17564, NULL, '2026-02-25 16:37:29', '2026-02-25 19:45:23', NULL, '2026-02-25 19:45:23'),
(219, 'f9d1c0a0-35b6-40dd-9b89-5eeff08e326f', 'deployment_guide', 'project', 'codocs/projects/huizhi-yun/docs/deployment_guide.md', 'zhouguangying', NULL, 'huizhi-yun', NULL, 0, 0, 0, NULL, NULL, 1, 17577, 'zhouguangying', '2026-02-25 16:38:53', '2026-02-25 19:27:43', NULL, NULL),
(220, 'ae41b618-ae18-4bdf-a529-8870736b60d1', 'PD031销售考核管理办法(2025年度02)', 'private', 'codocs/users/zhouguangying/docs/汇智云文档/PD031销售考核管理办法(2025年度02).md', 'zhouguangying', NULL, NULL, 1, 0, 0, 0, NULL, NULL, 0, 16567, NULL, '2026-02-25 19:54:06', '2026-03-09 10:14:17', NULL, '2026-03-09 10:14:17'),
(221, '768d2b20-0944-43a3-8501-64c25d219e37', '测试文档5', 'private', 'codocs/users/shiweijia/docs/未命名文档_03_04_14_07.md', 'shiweijia', NULL, NULL, NULL, 0, 0, 0, NULL, NULL, 1, 11, 'shiweijia', '2026-03-04 14:07:24', '2026-03-04 15:53:58', NULL, NULL),
(222, 'eeec5e46-ffb9-466c-a43d-7ff28401879b', '测试文档1', 'private', 'codocs/users/shiweijia/docs/未命名文档_03_04_14_08.md', 'shiweijia', NULL, NULL, NULL, 0, 0, 0, NULL, NULL, 1, 26, 'shiweijia', '2026-03-04 14:08:06', '2026-03-04 15:53:14', NULL, NULL),
(223, '44344f5f-fab6-4129-bfea-ef545aee53cc', '测试保存项目文档', 'private', 'codocs/users/shiweijia/docs/未命名文档_03_04_14_16.md', 'shiweijia', NULL, NULL, NULL, 0, 0, 0, NULL, NULL, 0, 21, 'shiweijia', '2026-03-04 14:16:56', '2026-03-04 15:52:16', NULL, '2026-03-04 15:52:16'),
(224, '8319c1f2-a107-4a73-b751-8c8a724de7aa', '测试文档3', 'private', 'codocs/users/shiweijia/docs/未命名文档_03_04_14_28.md', 'shiweijia', NULL, NULL, NULL, 0, 0, 0, NULL, NULL, 1, 74, 'shiweijia', '2026-03-04 14:28:27', '2026-03-04 15:53:33', NULL, NULL),
(225, 'e6b1ca3c-bf5e-4776-839a-ae0c91d7b88c', '测试文档4', 'private', 'codocs/users/shiweijia/docs/未命名文档_03_04_14_29.md', 'shiweijia', NULL, NULL, NULL, 0, 0, 0, NULL, NULL, 1, 36, 'shiweijia', '2026-03-04 14:29:05', '2026-03-04 15:53:46', NULL, NULL),
(226, '5ed84d72-ed70-4b07-9299-fa67ce9749cb', '测试文档2', 'private', 'codocs/users/shiweijia/docs/未命名文档_03_04_15_40.md', 'shiweijia', NULL, NULL, NULL, 0, 0, 0, NULL, NULL, 1, 58, 'shiweijia', '2026-03-04 15:40:55', '2026-03-04 15:41:17', NULL, NULL),
(227, '32df8028-7144-4703-8ff4-5984496b24c1', '未命名文档 03/04 16:07', 'private', 'codocs/users/douyanqun/docs/未命名文档_03_04_16_07.md', 'douyanqun', NULL, NULL, NULL, 0, 0, 0, NULL, NULL, 1, 0, NULL, '2026-03-04 16:07:48', '2026-03-04 16:07:48', NULL, NULL),
(228, '6bc16bac-f710-489e-bad0-324eea28e44c', '未命名文档 03/04 16:08', 'private', 'codocs/users/douyanqun/docs/未命名文档_03_04_16_08.md', 'douyanqun', NULL, NULL, NULL, 0, 0, 0, NULL, NULL, 1, 111, 'douyanqun', '2026-03-04 16:08:07', '2026-03-04 16:29:43', NULL, NULL),
(229, '86d79a77-04d5-4de2-baae-c2ded69a6765', 'CQ测试 03/04 16:29', 'private', 'codocs/users/caoqian/docs/未命名文档_03_04_16_29.md', 'caoqian', NULL, NULL, NULL, 0, 0, 0, NULL, NULL, 1, 102, 'caoqian', '2026-03-04 16:29:36', '2026-03-04 17:14:35', NULL, NULL),
(230, '02ed3d81-6fcb-43c8-bb22-24aa99909353', '未命1名文档 03/04 16:53', 'private', 'codocs/users/chenyiming/docs/未命名文档_03_04_16_53.md', 'chenyiming', NULL, NULL, NULL, 0, 0, 0, NULL, NULL, 1, 183, 'chenyiming', '2026-03-04 16:53:37', '2026-03-04 17:02:21', NULL, NULL),
(231, 'f8c1ca3f-e564-49ed-9f7b-8708c650db48', '未命名文档 03/04 17:04', 'private', 'codocs/users/chenyiming/docs/未命名文档_03_04_17_04.md', 'chenyiming', NULL, NULL, NULL, 0, 0, 0, NULL, NULL, 1, 0, NULL, '2026-03-04 17:04:08', '2026-03-04 17:04:08', NULL, NULL),
(232, '9c1b5842-6807-4bbc-81be-a0105742ac4d', '未命名文档 03/04 17:05', 'private', 'codocs/users/chenyiming/docs/未命名文档_03_04_17_05.md', 'chenyiming', NULL, NULL, NULL, 0, 0, 0, NULL, NULL, 1, 0, NULL, '2026-03-04 17:05:09', '2026-03-04 17:05:09', NULL, NULL),
(233, 'e0ab602d-989a-451e-a06f-54fe774730f5', 'TestDoc', 'project', 'codocs/projects/huizhi-yun/docs/TestFolder/TestDoc.md', 'zhouguangying', NULL, 'huizhi-yun', NULL, 0, 0, 0, NULL, NULL, 0, 0, NULL, '2026-03-05 00:59:26', '2026-03-05 08:21:05', NULL, '2026-03-05 08:21:05'),
(234, 'e48d7c05-a47a-411a-bbc1-4931cb994f1d', '未命名文档 03/05 08:56', 'private', 'codocs/users/guopeipei/docs/未命名文档_03_05_08_56.md', 'guopeipei', NULL, NULL, NULL, 0, 0, 0, NULL, NULL, 1, 51, 'guopeipei', '2026-03-05 08:56:44', '2026-03-05 08:57:48', NULL, NULL),
(235, 'd988fb5d-f6e3-436b-bed7-4f5d204c8502', 'AI 赋能与行动纲领 (2026)', 'private', 'codocs/users/zhouguangying/docs/技术委员会/AI_赋能与行动纲领_(2026).md', 'zhouguangying', NULL, NULL, 24, 1, 0, 0, NULL, NULL, 1, 2305, 'zhouguangying', '2026-03-05 09:19:23', '2026-03-09 18:58:18', NULL, NULL),
(236, 'bd6abfec-5e49-4bfd-9280-76fd5978685f', '未命名文档 03/05 13:32', 'private', 'codocs/users/caoqian/docs/未命名文档_03_05_13_32.md', 'caoqian', NULL, NULL, NULL, 0, 0, 0, NULL, NULL, 1, 0, NULL, '2026-03-05 13:32:42', '2026-03-05 13:32:42', NULL, NULL),
(237, 'e13d403d-ad32-4481-9054-d2b95dd3784d', '未命名文档 03/05 17:55', 'private', 'codocs/users/chenyiming/docs/未命名文档_03_05_17_55.md', 'chenyiming', NULL, NULL, NULL, 0, 0, 0, NULL, NULL, 1, 0, NULL, '2026-03-05 17:55:48', '2026-03-05 17:55:48', NULL, NULL),
(238, 'fec57201-16da-47e6-a3d2-458ae59c49ac', '未命名文档 03/05 17:56', 'private', 'codocs/users/chenyiming/docs/未命名文档_03_05_17_56.md', 'chenyiming', NULL, NULL, NULL, 0, 0, 0, NULL, NULL, 1, 0, NULL, '2026-03-05 17:56:11', '2026-03-05 17:56:11', NULL, NULL),
(239, '69253f31-9b58-40a4-9fc4-8c45d3dc2426', '未命名文2档 03/05 18:15', 'private', 'codocs/users/chenyiming/docs/未命名文档_03_05_18_15.md', 'chenyiming', NULL, NULL, NULL, 0, 0, 0, NULL, NULL, 1, 430, 'chenyiming', '2026-03-05 18:15:09', '2026-03-05 18:20:02', NULL, NULL),
(240, '6631c744-fdec-45ee-a9cb-113ad19081ae', '1-1', 'private', 'codocs/users/chenyiming/docs/1/1-1.md', 'chenyiming', NULL, NULL, 21, 0, 0, 0, NULL, NULL, 1, 40, 'chenyiming', '2026-03-05 18:22:14', '2026-03-05 18:24:02', NULL, NULL),
(241, 'ec926840-d1e9-434f-9fde-e112148fcc69', '部门文档1', 'department', 'codocs/departments/RD/docs/产品研发部/部门文档1.md', 'chenyiming', 'RD', NULL, NULL, 0, 0, 0, NULL, NULL, 0, 49, 'chenyiming', '2026-03-05 18:26:43', '2026-03-09 10:08:57', NULL, '2026-03-09 10:08:57'),
(242, '050f4ce6-e1c5-4edb-bf9c-171f977cc1a0', '未命名文档 03/06 22:50', 'private', 'codocs/users/zhouguangying/docs/未命名文档_03_06_22_50.md', 'zhouguangying', NULL, NULL, NULL, 0, 0, 0, NULL, NULL, 0, 0, NULL, '2026-03-07 10:50:57', '2026-03-07 19:47:28', NULL, '2026-03-07 19:47:28'),
(243, '5f81b285-9552-458a-b40b-4d5dfbf1b9ad', 'PD031销售考核管理办法_2026年度', 'private', 'codocs/users/zhouguangying/docs/管理文档/PD031销售考核管理办法_2026年度.md', 'zhouguangying', NULL, NULL, 23, 0, 0, 0, NULL, NULL, 1, 27294, 'zhouguangying', '2026-03-07 19:47:10', '2026-03-11 07:38:28', NULL, NULL),
(244, '1f3268fa-c9f0-49e3-8f99-d4606de7692c', '销售副总绩效考核办法2026', 'private', 'codocs/users/zhouguangying/docs/管理文档/销售副总绩效考核办法2026.md', 'zhouguangying', NULL, NULL, 23, 0, 0, 0, NULL, NULL, 1, 5500, 'zhouguangying', '2026-03-09 02:44:04', '2026-03-11 07:40:33', NULL, NULL),
(245, 'ab2cea24-2a45-4816-92f2-8b087e707703', '核心管理层成员年度目标责任书', 'private', 'codocs/users/zhouguangying/docs/管理文档/核心管理层成员年度目标责任书.md', 'zhouguangying', NULL, NULL, 23, 0, 0, 0, NULL, NULL, 1, 9782, 'zhouguangying', '2026-03-09 04:42:38', '2026-03-09 10:13:14', NULL, NULL),
(246, '24d1718a-2cd1-4b21-88ef-8234548dbf3b', '20260309-BZ-gitlab目录规范（草稿）', 'private', 'codocs/users/caoqian/docs/gitlab目录规范.md', 'caoqian', NULL, NULL, NULL, 0, 0, 0, NULL, NULL, 1, 810, 'caoqian', '2026-03-09 10:11:27', '2026-03-09 10:15:39', NULL, NULL),
(247, 'e426f62d-001d-40fb-a72d-f790c998ddb9', '共享文档规范', 'private', 'codocs/users/zhouguangying/docs/技术委员会/共享文档规范.md', 'zhouguangying', NULL, NULL, 24, 0, 0, 0, NULL, NULL, 1, 11938, 'zhouguangying', '2026-03-09 10:31:36', '2026-03-09 11:09:00', NULL, NULL),
(248, '40da2b63-5398-44c0-870a-777ee9a188c7', '公文格式说明', 'private', 'codocs/users/zhouguangying/docs/技术委员会/公文格式说明.md', 'zhouguangying', NULL, NULL, 24, 0, 0, 0, NULL, NULL, 1, 10686, NULL, '2026-03-09 10:31:44', '2026-03-09 10:31:44', NULL, NULL),
(250, 'fc265139-cc5e-4d12-a264-61943eb303ea', '软件工程的未来两年', 'company', 'codocs/company/软件工程的未来两年.md', 'zhouguangying', NULL, NULL, NULL, 0, 0, 0, NULL, NULL, 2, 17848, 'zhouguangying', '2026-03-10 10:24:29', '2026-03-10 10:24:29', NULL, NULL),
(251, 'e0578270-e908-4ff5-be2a-70076b8dde4b', '202603-BG-AI应用月报-曹倩', 'department', 'codocs/departments//docs/工作汇报/AI应用月报/2026-03/202603-BG-AI应用月报-曹倩.md', 'caoqian', 'RD', NULL, 36, 0, 0, 0, NULL, NULL, 1, 0, NULL, '2026-03-10 15:37:47', '2026-03-11 08:48:31', NULL, NULL),
(252, '20d71f52-d113-4a26-998e-b0c792fe8ebc', '未命名文档 03/10 16:09', 'private', 'codocs/users/wangguanghui/docs/未命名文档_03_10_16_09.md', 'wangguanghui', NULL, NULL, NULL, 0, 0, 0, NULL, NULL, 0, 0, NULL, '2026-03-10 16:09:09', '2026-03-10 16:27:12', NULL, '2026-03-10 16:27:12'),
(253, '2ed08c43-42d4-407a-818e-881ac8b96702', '未命名文档 03/10 16:24', 'private', 'codocs/users/wangguanghui/docs/未命名文档_03_10_16_24.md', 'wangguanghui', NULL, NULL, NULL, 0, 0, 0, NULL, NULL, 0, 2736, 'wangguanghui', '2026-03-10 16:24:28', '2026-03-10 16:27:17', NULL, '2026-03-10 16:27:17'),
(254, 'ef1dd4ba-a99e-4bee-b6bc-bc73c194f3aa', '软件工程的未来两年', 'company', 'codocs/departments/GMO/records/软件工程的未来两年.md', 'zhouguangying', 'GMO', NULL, NULL, 0, 0, 0, NULL, NULL, 2, 17848, 'zhouguangying', '2026-03-10 17:51:23', '2026-03-10 17:51:23', NULL, NULL),
(255, '54787f8c-b81c-4237-a718-b9bfcdd69748', '企业文化', 'department', 'codocs/departments/GMO/docs/企业文化.md', 'zhouguangying', 'GMO', NULL, NULL, 0, 0, 1, '已发布为企业文化', NULL, 0, 0, NULL, '2026-03-10 17:56:28', '2026-03-11 08:22:13', NULL, '2026-03-11 08:22:13'),
(256, '96cf7818-81a6-4462-aa49-7e9612a14dd6', '企业文化', 'company', 'codocs/company/culture/企业文化.md', 'zhouguangying', 'GMO', NULL, NULL, 0, 0, 0, NULL, NULL, 2, 0, 'zhouguangying', '2026-03-10 17:58:46', '2026-03-10 17:58:46', NULL, NULL),
(257, 'fdcfba10-3561-4e25-bf43-6ea448e2cb01', '公文格式说明', 'department', 'codocs/departments/TCMT/docs/公文格式说明.md', 'zhouguangying', 'TCMT', NULL, NULL, 0, 0, 1, '已发布为技术规范', NULL, 1, 10686, NULL, '2026-03-10 17:59:46', '2026-03-10 18:31:12', NULL, NULL),
(258, '81814c8d-c7b4-48cc-a1bd-78b35cafd874', '公文格式说明', 'company', 'codocs/company/tech-specs/公文格式说明.md', 'zhouguangying', 'TCMT', NULL, NULL, 0, 0, 0, NULL, NULL, 2, 10686, 'zhouguangying', '2026-03-10 18:31:11', '2026-03-10 18:31:11', NULL, NULL),
(259, '982103ad-0e48-41ce-8f57-0d590b96888e', '公文格式说明_20260310', 'department', 'codocs/departments/TCMT/docs/公文格式说明_20260310.md', 'zhouguangying', 'TCMT', NULL, NULL, 0, 0, 0, NULL, NULL, 0, 10686, 'zhouguangying', '2026-03-10 18:46:36', '2026-03-11 08:22:30', NULL, '2026-03-11 08:22:30'),
(260, 'aaf2af02-b3f4-4647-a1f8-de662336e6e7', '共享文档规范', 'department', 'codocs/departments/TCMT/docs/共享文档规范.md', 'zhouguangying', 'TCMT', NULL, NULL, 0, 0, 1, '{\"label\":\"组织资产/对外发文\",\"date\":\"2026-03-11T17:09:12.206Z\",\"archiveUuid\":\"14e18be5-a9f0-40bb-8cf2-64f3a8eb03ca\"}', NULL, 1, 11467, NULL, '2026-03-10 19:06:57', '2026-03-12 01:09:12', NULL, NULL),
(261, '5a0b05b9-99d9-4eaa-8c96-6e0762bdac72', '未命名文档 03/10 18:26', 'private', 'codocs/users/zhouguangying/docs/未命名文档_03_10_18_26.md', 'zhouguangying', NULL, NULL, NULL, 0, 0, 0, NULL, NULL, 0, 0, NULL, '2026-03-11 05:26:13', '2026-03-11 05:26:35', NULL, '2026-03-11 05:26:35'),
(262, '016492b8-bdd5-4472-98c0-c7b969a1ab5b', '文档协同系统架构蓝图', 'department', 'codocs/departments/MCMT/docs/文档协同系统架构蓝图.md', 'zhouguangying', 'MCMT', NULL, NULL, 0, 0, 1, NULL, NULL, 1, 5525, NULL, '2026-03-11 05:46:01', '2026-03-11 05:46:42', NULL, NULL),
(263, '6190bafb-f7fa-4c9f-b985-35e4a03e542e', '1需求文档', 'department', 'codocs/departments/GMO/docs/1需求文档.md', 'zhouguangying', 'GMO', NULL, NULL, 0, 0, 0, NULL, NULL, 0, 10873, NULL, '2026-03-11 06:01:32', '2026-03-11 08:22:09', NULL, '2026-03-11 08:22:09'),
(264, 'b1381e43-779a-49ac-9e71-a60840f3eba3', 'Huizhi-yun-PRD', 'department', 'codocs/departments/TCMT/coworks/Huizhi-yun-PRD_b1381e43.md', 'zhouguangying', 'TCMT', NULL, NULL, 0, 0, 0, NULL, NULL, 1, 10873, 'zhouguangying', '2026-03-11 08:19:10', '2026-03-11 08:19:10', NULL, NULL),
(266, '16c862a8-45f6-44c0-a348-c5ac05a588be', '公文格式说明_20260311', 'department', 'codocs/departments/TCMT/docs/公文格式说明_20260311.md', 'zhouguangying', 'TCMT', NULL, NULL, 0, 0, 0, NULL, NULL, 1, 10686, 'zhouguangying', '2026-03-11 08:38:01', '2026-03-11 08:38:01', NULL, NULL),
(267, '27172331-e99d-4ec9-a602-a23c966f5780', '文档测试', 'private', 'codocs/users/renjianwei/docs/测试专用文件夹/文档测试.md', 'renjianwei', NULL, NULL, 37, 0, 0, 0, NULL, NULL, 1, 1842, 'renjianwei', '2026-03-11 10:47:22', '2026-03-11 10:49:39', NULL, NULL),
(268, '14e18be5-a9f0-40bb-8cf2-64f3a8eb03ca', '共享文档规范', 'company', 'codocs/company/outsides/共享文档规范.md', 'zhouguangying', 'TCMT', NULL, NULL, 0, 0, 0, NULL, NULL, 2, 11467, 'zhouguangying', '2026-03-12 01:09:12', '2026-03-12 01:09:12', NULL, NULL),
(269, 'd4587439-c306-40e1-8496-168c6d976a22', '共享文档规范_20260311', 'department', 'codocs/departments/TCMT/docs/共享文档规范_20260311.md', 'zhouguangying', 'TCMT', NULL, NULL, 0, 0, 0, NULL, NULL, 1, 12799, 'zhouguangying', '2026-03-12 01:33:08', '2026-03-12 02:47:07', NULL, NULL),
(271, 'c47879b8-b843-4792-b05b-9cd4661fd503', 'README', 'git-project', 'huizhi-yun/account/README.md', 'zhouguangying', NULL, '30', NULL, 0, 0, 0, NULL, NULL, 1, 835, 'zhouguangying', '2026-01-25 14:34:48', '2026-01-25 14:34:48', '2026-01-25 14:34:48', NULL),
(272, '18e0d7da-6e0f-46ed-bdd5-99a99375d5ae', 'API_SPEC', 'git-project', 'huizhi-yun/account/docs/API_SPEC.md', 'zhouguangying', NULL, '30', NULL, 0, 0, 0, NULL, NULL, 1, 35829, 'zhouguangying', '2026-03-11 02:23:12', '2026-03-11 02:23:12', '2026-03-11 02:23:12', NULL),
(273, '903b8621-6e5a-4fa9-bcea-7b1e90907f68', 'Conflict-Ignore-Feature', 'git-project', 'huizhi-yun/account/docs/Conflict-Ignore-Feature.md', 'zhouguangying', NULL, '30', NULL, 0, 0, 0, NULL, NULL, 1, 9857, 'zhouguangying', '2026-01-27 17:37:05', '2026-01-27 17:37:05', '2026-01-27 17:37:05', NULL),
(274, 'c3ccb35a-979f-477b-b42a-b76bb04cdba9', 'Conflict-Resolution-Comparison', 'git-project', 'huizhi-yun/account/docs/Conflict-Resolution-Comparison.md', 'zhouguangying', NULL, '30', NULL, 0, 0, 0, NULL, NULL, 1, 5703, 'zhouguangying', '2026-01-24 20:30:09', '2026-01-24 20:30:09', '2026-01-24 20:30:09', NULL),
(275, '1a39f587-2457-489a-bcfc-e7974772fd28', 'Document-System-Integration', 'git-project', 'huizhi-yun/account/docs/Document-System-Integration.md', 'zhouguangying', NULL, '30', NULL, 0, 0, 0, NULL, NULL, 1, 8608, 'zhouguangying', '2026-01-27 17:37:05', '2026-01-27 17:37:05', '2026-01-27 17:37:05', NULL),
(276, '6b372823-44ce-44ae-8306-50af404b72cd', 'GitLab-API-Implementation', 'git-project', 'huizhi-yun/account/docs/GitLab-API-Implementation.md', 'zhouguangying', NULL, '30', NULL, 0, 0, 0, NULL, NULL, 1, 6946, 'zhouguangying', '2026-01-27 17:37:05', '2026-01-27 17:37:05', '2026-01-27 17:37:05', NULL),
(277, '86f60b54-9a48-45ac-88ee-8d25d535caed', 'GitLab-OSS-Sync-Logic', 'git-project', 'huizhi-yun/account/docs/GitLab-OSS-Sync-Logic.md', 'zhouguangying', NULL, '30', NULL, 0, 0, 0, NULL, NULL, 1, 9037, 'zhouguangying', '2026-01-25 17:43:50', '2026-01-25 17:43:50', '2026-01-25 17:43:50', NULL),
(278, 'e5a31e9a-19fe-4fa2-a6e2-e4dd3f764125', 'GitLab-Sync-README', 'git-project', 'huizhi-yun/account/docs/GitLab-Sync-README.md', 'zhouguangying', NULL, '30', NULL, 0, 0, 0, NULL, NULL, 1, 4895, 'zhouguangying', '2026-01-24 20:30:09', '2026-01-24 20:30:09', '2026-01-24 20:30:09', NULL),
(279, '61e6c7fd-6c25-47ad-a837-13e159749795', 'GitLab-Webhook-Setup', 'git-project', 'huizhi-yun/account/docs/GitLab-Webhook-Setup.md', 'zhouguangying', NULL, '30', NULL, 0, 0, 0, NULL, NULL, 1, 10127, 'zhouguangying', '2026-01-27 17:37:05', '2026-01-27 17:37:05', '2026-01-27 17:37:05', NULL),
(280, '10cf6cdc-4a09-4fb4-9fa8-8a06891948d6', 'Git提交规范指南', 'git-project', 'huizhi-yun/account/docs/Git提交规范指南.md', 'zhouguangying', NULL, '30', NULL, 0, 0, 0, NULL, NULL, 1, 6028, 'zhouguangying', '2026-01-19 22:29:54', '2026-01-19 22:29:54', '2026-01-19 22:29:54', NULL),
(281, '91222929-35c0-4d0e-97fa-d1d43dd15bac', 'Metadata-Structure', 'git-project', 'huizhi-yun/account/docs/Metadata-Structure.md', 'zhouguangying', NULL, '30', NULL, 0, 0, 0, NULL, NULL, 1, 9594, 'zhouguangying', '2026-01-24 20:30:09', '2026-01-24 20:30:09', '2026-01-24 20:30:09', NULL),
(282, '9b756dff-cb76-47d1-bc73-91ffee613878', 'OSS_BUCKET_SEPARATION', 'git-project', 'huizhi-yun/account/docs/OSS_BUCKET_SEPARATION.md', 'zhouguangying', NULL, '30', NULL, 0, 0, 0, NULL, NULL, 1, 2512, 'zhouguangying', '2026-03-07 20:54:13', '2026-03-07 20:54:13', '2026-03-07 20:54:13', NULL),
(283, '4a9e1c4e-636c-4ca2-a043-fd3ad6bd85b7', 'PRD', 'git-project', 'huizhi-yun/account/docs/PRD.md', 'zhouguangying', NULL, '30', NULL, 0, 0, 0, NULL, NULL, 1, 41960, 'zhouguangying', '2026-01-27 17:37:05', '2026-01-27 17:37:05', '2026-01-27 17:37:05', NULL);

--
-- Table structure for table `info_bookmarks`
--

DROP TABLE IF EXISTS `info_bookmarks`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `info_bookmarks` (
  `id` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `author_handle` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `content_snippet` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `full_content` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `source_url` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `has_external_link` tinyint(1) DEFAULT '0',
  `article_title` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT '',
  `cover_image` varchar(1024) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT '',
  `status` enum('pending','processing','processed','ignored') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT 'pending',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `post_time` datetime DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `info_bookmarks`
--

LOCK TABLES `info_bookmarks` WRITE;
/*!40000 ALTER TABLE `info_bookmarks` DISABLE KEYS */;
INSERT INTO `info_bookmarks` VALUES ('1813076703809577164','janilychen','最近一直在练习使用 AI 创作插画，整了个插画分享网站，陆陆续续更新了 500 多张，整了些适合咱开发者在开发网站时使用的插画，链接如下，全部免费可商用，提供 SVG 和 PNG 格式下载：\nhttps://t.co/qZtx2E9YiR https://t.co/2ABiZ8Z436','最近一直在练习使用 AI 创作插画，整了个插画分享网站，陆陆续续更新了 500 多张，整了些适合咱开发者在开发网站时使用的插画，链接如下，全部免费可商用，提供 SVG 和 PNG 格式下载：\nhttps://t.co/qZtx2E9YiR https://t.co/2ABiZ8Z436\n\n![image](https://pbs.twimg.com/media/GSlW-UzbIAArmoG.jpg)\n','https://vectorcraftr.com/',1,'','','processed','2026-03-08 17:38:01','2024-07-16 13:02:26'),('1813937442959020134','tuturetom','Mem0 是 RAG 发展的下一个阶段，相比 RAG 的核心区别：  \n\n- 关注实体和实体关系 \n- 关注最近、最相关和遗忘 \n- 上下文接力 - 适应性学习 \n- 动态更新信息  而普通 RAG 只是单纯的从静态的文档中检索信息\n\nhttps://t.co/hOHOfKTMF7 https://t.co/wkfw44Snhc','Mem0 是 RAG 发展的下一个阶段，相比 RAG 的核心区别：  \n\n- 关注实体和实体关系 \n- 关注最近、最相关和遗忘 \n- 上下文接力 - 适应性学习 \n- 动态更新信息  而普通 RAG 只是单纯的从静态的文档中检索信息\n\nhttps://t.co/hOHOfKTMF7 https://t.co/wkfw44Snhc\n\n![image](https://pbs.twimg.com/media/GSxmb4nbkAA_t7K.jpg)\n','https://docs.mem0.ai/overview',1,'','','processed','2026-03-08 17:38:01','2024-07-18 22:02:42'),('1816654132398424394','vikingmute','Whimsical 是我用过最好用的画原型和流程图的工具，非常 intuitive， 用起来非常舒服，界面简洁美观，我的课程一直用的都是它，最近打开，发现现在免费版好像能创建无限个 board 了，简直是太良心了，一般个人用免费版足足够用了。\n\nhttps://t.co/C26cbB7n6j','Whimsical 是我用过最好用的画原型和流程图的工具，非常 intuitive， 用起来非常舒服，界面简洁美观，我的课程一直用的都是它，最近打开，发现现在免费版好像能创建无限个 board 了，简直是太良心了，一般个人用免费版足足够用了。\n\nhttps://t.co/C26cbB7n6j\n\n![image](https://pbs.twimg.com/media/GTYM3vqawAAbnBy.jpg)\n','http://whimsical.com',1,'','','processed','2026-03-08 17:38:01','2024-07-26 09:57:52'),('1819656985060823405','jxdxsff','提升部署在cloudflare网站访问的稳定性\n最近一直苦恼cloudflare在国内访问速度慢，今天顺着\n@evanlong_zh\n推荐的https://t.co/ntHRIY7gzO，一步步把访问速度从图1提升到图2，起飞 ！','提升部署在cloudflare网站访问的稳定性\n最近一直苦恼cloudflare在国内访问速度慢，今天顺着\n@evanlong_zh\n推荐的https://t.co/ntHRIY7gzO，一步步把访问速度从图1提升到图2，起飞 ！\n\n![image](https://pbs.twimg.com/media/GUC4GaZbAAACHsx.png)\n![image](https://pbs.twimg.com/media/GUC4JDSaQAAW_q5.png)\n','https://github.com/xingpingcn/enhanced-FaaS-in-China',1,'','','pending','2026-03-08 17:38:01','2024-08-03 16:50:07'),('1821553377152537013','knowledgefxg','为啥程序员都爱用Markdown？\nMarkdown是一种轻量级标记语言，让你用简单的纯文本格式编写文档，轻松转换成格式丰富的HTML。今天给大家简单总结6个点并给4个网站学习帮助学习这门语言。\n\n1. Markdown Guide\nhttps://t.co/Rqweo6vRVt\n官方指导从入门到精通。\n\n2. GitHub Markdown教程\nhttps://t.co/D4LdqKY601\nGitHub官方出品，质量杠杠。\n\n3. CommonMark\nhttps://t.co/wiyyBqXw8o\n这里有个交互式教程，边学边练，特别有意思。\n\n4.W3Schools Markdown教程\nhttps://t.co/3hjOMcC488\nW3Schools出品，你懂的，质量有保证。','为啥程序员都爱用Markdown？\nMarkdown是一种轻量级标记语言，让你用简单的纯文本格式编写文档，轻松转换成格式丰富的HTML。今天给大家简单总结6个点并给4个网站学习帮助学习这门语言。\n\n1. Markdown Guide\nhttps://t.co/Rqweo6vRVt\n官方指导从入门到精通。\n\n2. GitHub Markdown教程\nhttps://t.co/D4LdqKY601\nGitHub官方出品，质量杠杠。\n\n3. CommonMark\nhttps://t.co/wiyyBqXw8o\n这里有个交互式教程，边学边练，特别有意思。\n\n4.W3Schools Markdown教程\nhttps://t.co/3hjOMcC488\nW3Schools出品，你懂的，质量有保证。\n\n![image](https://pbs.twimg.com/media/GUd1Fk2WIAA6uKk.jpg)\n','https://www.markdownguide.org/',1,'','','pending','2026-03-08 17:38:01','2024-08-08 22:25:43'),('1822785196258992519','laobaishare','掌握这 850 个单词就能理解 90% 的英语！\n\n一本牛津词典大概有超过 2.5 万的单词\n\n有学者发现，你只需要掌握 850 个英语单词，就能理解牛津词典中 90% 的英语概念\n\n共分为 5 类\n\n分别是：介词、普通名词、具体事务、形容词和反义词。\n\n网站：https://t.co/GrXycC0JgL https://t.co/gOwxUeXy1z','掌握这 850 个单词就能理解 90% 的英语！\n\n一本牛津词典大概有超过 2.5 万的单词\n\n有学者发现，你只需要掌握 850 个英语单词，就能理解牛津词典中 90% 的英语概念\n\n共分为 5 类\n\n分别是：介词、普通名词、具体事务、形容词和反义词。\n\n网站：https://t.co/GrXycC0JgL https://t.co/gOwxUeXy1z\n\n![image](https://pbs.twimg.com/media/GUvVeC6aIAA2hJf.jpg)\n','http://zbenglish.net/sites/basic/basiceng.html',1,'','','ignored','2026-03-08 17:38:01','2024-08-12 08:00:31'),('1854769142752219390','luobogooooo','好开心！没想到 Stripe 注册一周就搞定了。强推谭铁铁大大这篇注册攻略，跟着走下来丝般顺滑。成本主要在注册英国公司 700 RMB。证件准备护照、外币银行卡(比如招商卡、OCBC)、国外电话卡，门槛是真的低。再分享一些个人踩过的小坑。\n\nhttps://t.co/9KMcIIdG17','好开心！没想到 Stripe 注册一周就搞定了。强推谭铁铁大大这篇注册攻略，跟着走下来丝般顺滑。成本主要在注册英国公司 700 RMB。证件准备护照、外币银行卡(比如招商卡、OCBC)、国外电话卡，门槛是真的低。再分享一些个人踩过的小坑。\n\nhttps://t.co/9KMcIIdG17','https://mp.weixin.qq.com/s/vfxPYglXtxnFN9R7vvfKzw',1,'','','ignored','2026-03-08 17:38:01','2024-11-08 14:13:18'),('1890593917164249118','yangyi','《长日将尽》是贝佐斯最爱的一本书。\n他连续25年反复阅读这本书，并从中获得灵感创造了他最著名的决策模型。\n\n以下是帮助他打造了市值超2000亿美元的亚马逊帝国的7个启示? https://t.co/gjntjvpRoM','《长日将尽》是贝佐斯最爱的一本书。\n他连续25年反复阅读这本书，并从中获得灵感创造了他最著名的决策模型。\n\n以下是帮助他打造了市值超2000亿美元的亚马逊帝国的7个启示? https://t.co/gjntjvpRoM\n\n![image](https://pbs.twimg.com/media/Gjy8aaobEAAOo9c.png)\n','https://x.com/yangyi/status/1890593917164249118',0,'','','ignored','2026-03-08 17:38:01','2025-02-15 10:48:10'),('1926347798150082640','realPureNomad','最近因为要出门，突击搭建了家庭网络，为确保能在全球各地用笔记本和手机随时随地访问家里的电脑，本准备上 tailscale，发现是商业软件，遂放弃。上了开源的 wg-easy，在 VPS 上装一个，有 web ui，给所有设备都生成一个 wireguard 配置文件。这样就组成了无敌私人局域网，手机也能加入。目标达成。 https://t.co/t69wmwmR9c','最近因为要出门，突击搭建了家庭网络，为确保能在全球各地用笔记本和手机随时随地访问家里的电脑，本准备上 tailscale，发现是商业软件，遂放弃。上了开源的 wg-easy，在 VPS 上装一个，有 web ui，给所有设备都生成一个 wireguard 配置文件。这样就组成了无敌私人局域网，手机也能加入。目标达成。 https://t.co/t69wmwmR9c\n\n![image](https://pbs.twimg.com/media/GrvA7o_X0AADUo1.jpg)\n','https://x.com/realPureNomad/status/1926347798150082640',0,'','','ignored','2026-03-08 17:38:01','2025-05-25 02:41:20'),('2010836969916420578','dotey','https://t.co/VyuHbMEPC0','https://t.co/VyuHbMEPC0','http://x.com/i/article/2010747149902823424',1,'AI 时代，产品经理的\"翻译层\"正在消失','https://pbs.twimg.com/media/G-eb8G8WQAINOcE.jpg','processed','2026-03-08 17:38:01','2026-01-13 06:11:08'),('2010852013874045284','dotey','https://t.co/BBq68Ys14f','https://t.co/BBq68Ys14f','http://x.com/i/article/2010850849648431105',1,'翻译：软件工程的未来两年','https://pbs.twimg.com/media/G-f7HewXkAAwwTm.jpg','processed','2026-03-08 17:38:01','2026-01-13 07:10:55'),('2011355230336918009','zstmfhy','目前 GitHub 上最热门的 Claude Skills 相关开源项目（按 Stars 数降序排列，数据基于 2026 年 1 月最新公开信息，实际数字以 GitHub 实时为准），官方项目放在首位：\n\n1. 官方 Anthropic 出品\n   anthropics/skills （官方 Agent Skills 公共仓库，包含大量高质量示例技能，如文档处理、web artifacts、MCP builder 等，是最权威的起点）  \n   ⭐ 约 39.4k  \n   https://t.co/oF3P2dwlMX\n\n2. obra/superpowers\n   Claude Code 超强核心技能库，内置 20+ 实战技能（TDD、debug、协作模式等），社区公认最强之一  \n   ⭐ 约 21.1k  \n   https://t.co/2LM1den7QD\n\n3. ComposioHQ/awesome-claude-skills\n   最受欢迎的 Awesome 列表之一，汇集大量官方+社区技能，覆盖开发、数据分析、商业等领域  \n   ⭐ 约 18.9k  \n   htt','目前 GitHub 上最热门的 Claude Skills 相关开源项目（按 Stars 数降序排列，数据基于 2026 年 1 月最新公开信息，实际数字以 GitHub 实时为准），官方项目放在首位：\n\n1. 官方 Anthropic 出品\n   anthropics/skills （官方 Agent Skills 公共仓库，包含大量高质量示例技能，如文档处理、web artifacts、MCP builder 等，是最权威的起点）  \n   ⭐ 约 39.4k  \n   https://t.co/oF3P2dwlMX\n\n2. obra/superpowers\n   Claude Code 超强核心技能库，内置 20+ 实战技能（TDD、debug、协作模式等），社区公认最强之一  \n   ⭐ 约 21.1k  \n   https://t.co/2LM1den7QD\n\n3. ComposioHQ/awesome-claude-skills\n   最受欢迎的 Awesome 列表之一，汇集大量官方+社区技能，覆盖开发、数据分析、商业等领域  \n   ⭐ 约 18.9k  \n   https://t.co/YsFhm7awFE\n\n4. travisvn/awesome-claude-skills\n   优质精选列表，专注 Claude Code 工作流定制，资源丰富，适合快速发现新技能  \n   ⭐ 约 4.8k+（部分 Awesome 列表星数波动较大）  \n   https://t.co/ML0ZTAjNcF\n\n5. K-Dense-AI/claude-scientific-skills  \n   专为科学研究打造，140+ 科学领域技能（生物、化学、数据分析、数据库整合等），研究人员必备  \n   ⭐ 约 5.8k  \n   https://t.co/CbZz6ab87p\n\n这些都是目前收藏数最高的实用项目！官方的 anthropics/skills 质量最稳定，适合作为入门起点；Awesome 列表则是快速探索海量新技能的最佳入口。\n\n使用方法超简单：把技能文件夹复制到 `~/.claude/skills/`（个人全局）或项目内的 `.claude/skills/`，Claude 就会自动发现并按需加载～\n\n推荐先从官方仓库开始试用！','https://x.com/zstmfhy/status/2011355230336918009',0,'GitHub - anthropics/skills: Public repository for Agent Skills','https://pbs.twimg.com/card_img/2030674173237092352/DsfW0onj?format=jpg&name=600x600','processed','2026-03-08 17:38:01','2026-01-14 16:30:31'),('2012762684413157408','allen_su1024','今天为了上一个Vibe coding的课，从Cursor转战Antigravity，美区账户+tun+美国ip，试了几个谷歌账户，搞了40分钟全都失败。\n\n结果下了这个Antigravity tools，点一下“嗖”就打开了，像是黑魔法一样。豁然开朗的感觉真爽，果真没有什么能难倒华人开发者。 https://t.co/XWOakP3IZY','今天为了上一个Vibe coding的课，从Cursor转战Antigravity，美区账户+tun+美国ip，试了几个谷歌账户，搞了40分钟全都失败。\n\n结果下了这个Antigravity tools，点一下“嗖”就打开了，像是黑魔法一样。豁然开朗的感觉真爽，果真没有什么能难倒华人开发者。 https://t.co/XWOakP3IZY\n\n![image](https://pbs.twimg.com/media/G-7D6NwWgAAAbSk.jpg)\n![image](https://pbs.twimg.com/media/G-7D7MmWwAABEpF.png)\n','https://x.com/allen_su1024/status/2012762684413157408',0,'','','processed','2026-03-08 17:38:01','2026-01-18 13:43:14'),('2013763086625157608','realNyarime','https://t.co/FjagoEoGAR','https://t.co/FjagoEoGAR','http://x.com/i/article/2013757790515564544',1,'Cloudflare Snippets白嫖无限流量vless ws + trojan节点（附教程）','https://pbs.twimg.com/media/G_JXUufaoAANSed.jpg','processed','2026-03-08 17:38:01','2026-01-21 07:58:28'),('2013773770503397564','realNyarime','https://t.co/tGzVzWAxVz','https://t.co/tGzVzWAxVz','http://x.com/i/article/2013763312983379968',1,'白嫖Cloudflare Pages部署VLess、Trojan、xhttp节点并优选（无需服务器）','https://pbs.twimg.com/media/G_JYLGDaYAAZ1LS.jpg','processed','2026-03-08 17:38:01','2026-01-21 08:40:56'),('2017042909959508040','geekbb','这项目冲得有多快呢，一天 2.2k Star 吧。\n\n将 Mermaid 图表渲染为美观的 SVG 或 ASCII 艺术字，纯 TypeScript 的轮子，零 DOM 依赖，跑起来快得飞起，500ms 内能给你刷出 100+ 张图，渲染速度极快。\n\n我现在都是把项目甩到 Moltbot 玩，请叫我部署大师?\n\nBeautiful-mermaid https://t.co/nMotTaSCaJ https://t.co/nGX3Qmzkal','这项目冲得有多快呢，一天 2.2k Star 吧。\n\n将 Mermaid 图表渲染为美观的 SVG 或 ASCII 艺术字，纯 TypeScript 的轮子，零 DOM 依赖，跑起来快得飞起，500ms 内能给你刷出 100+ 张图，渲染速度极快。\n\n我现在都是把项目甩到 Moltbot 玩，请叫我部署大师?\n\nBeautiful-mermaid https://t.co/nMotTaSCaJ https://t.co/nGX3Qmzkal\n\n![image](https://pbs.twimg.com/media/G_34p_ebUAIfJBq.jpg)\n','https://github.com/lukilabs/beautiful-mermaid',1,'','','processed','2026-03-08 17:38:01','2026-01-30 09:11:19'),('2017938482472141188','yupi996','用 AI 做项目，功能越加越多，改着改着把之前的逻辑搞坏了? 问 AI 之前为什么这么写，它也说不清楚……\n\n有个轻量开源框架叫 OpenSpec，专门解决这个问题。它的核心思路是：每次改功能，先写变更提案，确认后再写代码，写完自动同步到文档，让文档和代码始终保持一致。\n\n具体分 4 步走：\n1. 起草变更提案：描述要改什么、为什么改\n2. 审查确认：仔细看看有没有问题\n3. 实现变更：AI 按任务列表逐个完成\n4. 归档同步：自动把变更记录合并到主文档\n\n每次变更都有记录，之后再回来看也能快速理解当时的决策，再也不用猜之前为什么这么改。\n\n这玩意比 Spec-kit 那套 7 步流程轻量很多，特别适合在老项目上加功能、迭代优化。从 0 开始做大项目的话，可以看看 Spec-kit。','用 AI 做项目，功能越加越多，改着改着把之前的逻辑搞坏了? 问 AI 之前为什么这么写，它也说不清楚……\n\n有个轻量开源框架叫 OpenSpec，专门解决这个问题。它的核心思路是：每次改功能，先写变更提案，确认后再写代码，写完自动同步到文档，让文档和代码始终保持一致。\n\n具体分 4 步走：\n1. 起草变更提案：描述要改什么、为什么改\n2. 审查确认：仔细看看有没有问题\n3. 实现变更：AI 按任务列表逐个完成\n4. 归档同步：自动把变更记录合并到主文档\n\n每次变更都有记录，之后再回来看也能快速理解当时的决策，再也不用猜之前为什么这么改。\n\n这玩意比 Spec-kit 那套 7 步流程轻量很多，特别适合在老项目上加功能、迭代优化。从 0 开始做大项目的话，可以看看 Spec-kit。\n\n![image](https://pbs.twimg.com/media/HACzQs8aQAEREzH.jpg)\n![image](https://pbs.twimg.com/media/HACzQtDa4AADFz8.jpg)\n![image](https://pbs.twimg.com/media/HACzQtBacAApvLB.jpg)\n','https://x.com/yupi996/status/2017938482472141188',0,'','','processed','2026-03-08 17:38:01','2026-02-01 20:30:00'),('2020345793098707305','AYi_AInotes','刷到Miles大神的这个Claude code Prompt，卧槽太顶了，\n必须分享下，简直是教科书级别，\n这才是Claude code的正确打开方式啊兄弟们，\n咱们很多人用 Claude Code 或 Cursor 觉得不好用，\n估计跟我一样还只是把它当做一个 AI 工具，用指令逻辑驱动，\nMiles这个妙的点是用组织管理的逻辑驾驭 AI，\n不着急让 AI 写代码，\n先花 80% 的篇幅教 AI 怎么做个好员工，比如\n1️⃣ 敢于质疑老板，Challenge assumptions\n2️⃣ 做事有章法，Discovery -> Planning -> Building\n3️⃣ 凡事有交代，Stop and check in\n\n整个 Prompt 的架构也很硬，这里放下内核框架大家感受下，原版 Prompt 我提取出来放评论区̋(ˊ•͈ꇴ•͈ˋ)\n\n1. Role Definition (角色升维)：从 Coder 升级为 Technical Co-Founder。不仅写代码，还负责技术决策和怼老板（Challenge assumptions）\n2. Process Control (','刷到Miles大神的这个Claude code Prompt，卧槽太顶了，\n必须分享下，简直是教科书级别，\n这才是Claude code的正确打开方式啊兄弟们，\n咱们很多人用 Claude Code 或 Cursor 觉得不好用，\n估计跟我一样还只是把它当做一个 AI 工具，用指令逻辑驱动，\nMiles这个妙的点是用组织管理的逻辑驾驭 AI，\n不着急让 AI 写代码，\n先花 80% 的篇幅教 AI 怎么做个好员工，比如\n1️⃣ 敢于质疑老板，Challenge assumptions\n2️⃣ 做事有章法，Discovery -> Planning -> Building\n3️⃣ 凡事有交代，Stop and check in\n\n整个 Prompt 的架构也很硬，这里放下内核框架大家感受下，原版 Prompt 我提取出来放评论区̋(ˊ•͈ꇴ•͈ˋ)\n\n1. Role Definition (角色升维)：从 Coder 升级为 Technical Co-Founder。不仅写代码，还负责技术决策和怼老板（Challenge assumptions）\n2. Process Control (流程锁定)：强制分阶段（Discovery -> Planning -> Building...），防止 AI 一上来就瞎写一通\n3. Communication Protocol (沟通协议)：明确“讲人话”（plain language）和“决策权归属”（keep me in the loop）\n4. Anti-Fragile (反脆弱)：预设了“Handle edge cases”、“Not a hackathon project”，要求生产级质量\n\nAnchor Points (物理触点):\n• Hackathon project（反面教材）\n• Real product（交付标准）\n• Technical jargon（被禁止的黑话）\n• Version 1（MVP思维）\n\nDrafting Strategy:\n• Intro: 直接点破本质——这是在雇佣一个CTO，而不是一个码农\n\n• Deconstruction: 分模块拆解（Role, Phases, Rules），每一个点都要解释“为什么这样写比普通 Prompt 强”\n\n• Highlight: 重点强调 Phase 1 的“Challenge assumptions”和 Phase 3 的“Stop and check in”\n\n• Ending: 总结这个 Prompt 的核心心法\n\n![image](https://pbs.twimg.com/media/HAm1yTEaYAEDBZH.jpg)\n','https://x.com/AYi_AInotes/status/2020345793098707305',0,'','','processed','2026-03-08 17:38:01','2026-02-08 11:55:48'),('2021067611212267656','imauser73','https://t.co/kuqjkkOC1t','https://t.co/kuqjkkOC1t','http://x.com/i/article/2021052844774916098',1,'AI 时代的 Markdown 终极指南：从入门到进阶','https://pbs.twimg.com/media/HAw_6elaAAManml.jpg','processed','2026-03-08 17:38:01','2026-02-10 11:44:03'),('2025402153754333307','0xarch1tect','full md file if anyone is interested (fixed the typeo in #6)\nvvvvvvvvvvvvvvvvvvvvvvvvvvvvv\n\n## Workflow Orchestration\n\n### 1. Plan Node Default\n- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)\n- If something goes sideways, STOP and re-plan immediately - don\'t keep pushing\n- Use plan mode for verification steps, not just building\n- Write detailed specs upfront to reduce ambiguity\n\n### 2. Subagent Strategy\n- Use subagents liberally to keep main context window clean\n','full md file if anyone is interested (fixed the typeo in #6)\nvvvvvvvvvvvvvvvvvvvvvvvvvvvvv\n\n## Workflow Orchestration\n\n### 1. Plan Node Default\n- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)\n- If something goes sideways, STOP and re-plan immediately - don\'t keep pushing\n- Use plan mode for verification steps, not just building\n- Write detailed specs upfront to reduce ambiguity\n\n### 2. Subagent Strategy\n- Use subagents liberally to keep main context window clean\n- Offload research, exploration, and parallel analysis to subagents\n- For complex problems, throw more compute at it via subagents\n- One tack per subagent for focused execution\n\n### 3. Self-Improvement Loop\n- After ANY correction from the user: update `tasks/lessons.md` with the pattern\n- Write rules for yourself that prevent the same mistake\n- Ruthlessly iterate on these lessons until mistake rate drops\n- Review lessons at session start for relevant project\n\n### 4. Verification Before Done\n- Never mark a task complete without proving it works\n- Diff behavior between main and your changes when relevant\n- Ask yourself: \"Would a staff engineer approve this?\"\n- Run tests, check logs, demonstrate correctness\n\n### 5. Demand Elegance (Balanced)\n- For non-trivial changes: pause and ask \"is there a more elegant way?\"\n- If a fix feels hacky: \"Knowing everything I know now, implement the elegant solution\"\n- Skip this for simple, obvious fixes - don\'t over-engineer\n- Challenge your own work before presenting it\n\n### 6. Autonomous Bug Fixing\n- When given a bug report: just fix it. Don\'t ask for hand-holding\n- Point at logs, errors, failing tests - then resolve them\n- Zero context switching required from the user\n- Go fix failing CI tests without being told how\n\n## Task Management\n\n1. **Plan First**: Write plan to `tasks/todo.md` with checkable items\n2. **Verify Plan**: Check in before starting implementation\n3. **Track Progress**: Mark items complete as you go\n4. **Explain Changes**: High-level summary at each step\n5. **Document Results**: Add review section to `tasks/todo.md`\n6. **Capture Lessons**: Update `tasks/lessons.md` after corrections\n\n## Core Principles\n\n- **Simplicity First**: Make every change as simple as possible. Impact minimal code.\n- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards.\n- **Minimat Impact**: Changes should only touch what\'s necessary. Avoid introducing bugs.','https://x.com/0xarch1tect/status/2025402153754333307',0,'','','processed','2026-03-08 17:38:01','2026-02-22 10:47:58'),('2025571795383001245','RealWayneSun','https://t.co/yue0hHZbzH','https://t.co/yue0hHZbzH','http://x.com/i/article/2025569099074674689',1,'烧了百亿Token，非程序视角下的一些感悟','https://pbs.twimg.com/media/HBxEoE_bYAApDcv.jpg','processed','2026-03-08 17:38:01','2026-02-22 22:02:04'),('2025602594681561509','Carlos_Gong','Boris Tane 的 Claude Code 用法分享（https://t.co/Y5W7QEoxoL）写得很好，在 Hacker News 上有 400 多个讨论（https://t.co/8lCqiCZQUY）。\n\n让 Codex 做了个中文机翻版本，本地存个档：https://t.co/FWrYRNxEir\n\n原始网页的流程图是 Mermaid 代码，5.3 High 的 one-shot 处理得不好看，但能看懂。','Boris Tane 的 Claude Code 用法分享（https://t.co/Y5W7QEoxoL）写得很好，在 Hacker News 上有 400 多个讨论（https://t.co/8lCqiCZQUY）。\n\n让 Codex 做了个中文机翻版本，本地存个档：https://t.co/FWrYRNxEir\n\n原始网页的流程图是 Mermaid 代码，5.3 High 的 one-shot 处理得不好看，但能看懂。','https://boristane.com/blog/how-i-use-claude-code/',1,'How I Use Claude Code | Boris Tane','https://pbs.twimg.com/card_img/2029238488822849536/qh1ifaAY?format=png&name=600x600','processed','2026-03-08 17:38:01','2026-02-23 00:04:27'),('2025864146466529519','shao__meng','逛 Reddit 看到的 OpenClaw 最佳实践，5 个基本原则\n\n1. 安全第一：绝不盲装 ClawHub 技能\n· 自己写 SKILL. md（纯 Markdown 说明即可）\n· 含 scripts/ 的必须逐行审查\n· 只用内置工具（web_fetch、web_search、exec）的技能最安全\n· 零依赖 = 最优\n\n2. 文件即大脑（最重要！）\n所有上下文必须落地，否则 compaction 后全部丢失：\n· MEMORY. md → 长期记忆\n· memory/YYYY-MM-DD.md → 每日日志\n· ACTIVE-TASK. md → 当前任务工作记忆\n· 工作中途也要 checkpoint\n\n3. 模型分层\n· 主智能体 → Claude Opus（协调、复杂推理）\n· 子任务/专项 → Claude Sonnet（5 倍性价比）\n· 必须配置模型回退机制\n备注：这里可以把 Claude 模型对应替换为其他你自己测试过的模型，来降低成本。\n\n4. Cron 驱动一切\n把晨报、收件箱、监控、扫描等全部定时化，合并成少数「心跳任务」。\n\n5. 极简技能哲学\n最好','逛 Reddit 看到的 OpenClaw 最佳实践，5 个基本原则\n\n1. 安全第一：绝不盲装 ClawHub 技能\n· 自己写 SKILL. md（纯 Markdown 说明即可）\n· 含 scripts/ 的必须逐行审查\n· 只用内置工具（web_fetch、web_search、exec）的技能最安全\n· 零依赖 = 最优\n\n2. 文件即大脑（最重要！）\n所有上下文必须落地，否则 compaction 后全部丢失：\n· MEMORY. md → 长期记忆\n· memory/YYYY-MM-DD.md → 每日日志\n· ACTIVE-TASK. md → 当前任务工作记忆\n· 工作中途也要 checkpoint\n\n3. 模型分层\n· 主智能体 → Claude Opus（协调、复杂推理）\n· 子任务/专项 → Claude Sonnet（5 倍性价比）\n· 必须配置模型回退机制\n备注：这里可以把 Claude 模型对应替换为其他你自己测试过的模型，来降低成本。\n\n4. Cron 驱动一切\n把晨报、收件箱、监控、扫描等全部定时化，合并成少数「心跳任务」。\n\n5. 极简技能哲学\n最好的技能往往没有一行代码，只是一份写得好的 SKILL. md，教智能体如何用内置工具完成任务。\n\n推荐项目结构（社区标准）\n~/workspace/\n├── SOUL. md          # 人格\n├── MEMORY. md        # 长期记忆\n├── ACTIVE-TASK. md   # 当前任务\n├── HEARTBEAT. md     # 定时任务清单\n├── memory/          # 日志\n└── skills/          # 自定义技能\n\n常见问题避雷\n· 运行中改配置\n· 信 ClawHub 下载量\n· 不读 Skills 就安装\n· 让智能体无批准发邮件/推文\n\nReddit 地址：\nhttps://t.co/yQAtYpbgTQ\n\n![image](https://pbs.twimg.com/media/HB1QnGhbsAAFV1u.jpg)\n','https://x.com/shao__meng/status/2025864146466529519',0,'','','processed','2026-03-08 17:38:01','2026-02-23 17:23:46'),('2026475225257234664','verysmallwoods','https://t.co/o1IQhyI3AO','https://t.co/o1IQhyI3AO','http://x.com/i/article/2026474028764975104',1,'Cloudflare 工程主管的 Claude Code 工作流：先研究，再规划，最后才写代码','https://pbs.twimg.com/media/HB98bSVWoAEXBBv.jpg','processed','2026-03-08 17:38:01','2026-02-25 09:51:58'),('2027710692418326732','sitinme','Redis 作者 antirez 用 Claude Code 写了一个 Z80/ZX Spectrum 模拟器\n\n不是写 CRUD，是硬件模拟。这才是 Claude Code 的正确打开方式。\n\n他的方法很有意思：\n\n1. 先写一份 Markdown 规格说明，把设计要求写清楚\n2. 让 Claude Code 上网搜 Z80 技术文档，提取成 markdown\n3. 删掉这个 session（防止代码污染）\n4. 新开 session，只用收集的文档，禁止联网，让 AI 自主编码\n\n结果：Z80 + ZX Spectrum + CP/M 模拟器全部完成。\n\n关键教训：\n- 人负责设计决策，AI 负责实现\n- 好的 prompt 规格说明 = 好的结果\n- Clean Room 方法论值得学习\n\n源码：https://t.co/OKv2TTfyFP\n原文：https://t.co/r4VdlymYbJ','Redis 作者 antirez 用 Claude Code 写了一个 Z80/ZX Spectrum 模拟器\n\n不是写 CRUD，是硬件模拟。这才是 Claude Code 的正确打开方式。\n\n他的方法很有意思：\n\n1. 先写一份 Markdown 规格说明，把设计要求写清楚\n2. 让 Claude Code 上网搜 Z80 技术文档，提取成 markdown\n3. 删掉这个 session（防止代码污染）\n4. 新开 session，只用收集的文档，禁止联网，让 AI 自主编码\n\n结果：Z80 + ZX Spectrum + CP/M 模拟器全部完成。\n\n关键教训：\n- 人负责设计决策，AI 负责实现\n- 好的 prompt 规格说明 = 好的结果\n- Clean Room 方法论值得学习\n\n源码：https://t.co/OKv2TTfyFP\n原文：https://t.co/r4VdlymYbJ\n\n![image](https://pbs.twimg.com/media/HCPgHrvbkAAcAEs.jpg)\n','https://x.com/sitinme/status/2027710692418326732',0,'','','processed','2026-03-08 17:38:01','2026-02-28 19:41:17'),('2028099767968903629','yanhua1010','https://t.co/ZYQf0kBM9C','https://t.co/ZYQf0kBM9C','http://x.com/i/article/2028097395402375168',1,'用了 3 个月 Claude Code，这 9 条最佳实践让我少走了无数弯路','https://pbs.twimg.com/media/HCVBaAuawAANTPl.jpg','processed','2026-03-08 17:38:01','2026-03-01 21:27:20'),('2028132386756780220','wangray','https://t.co/vAIm9LkIlq','https://t.co/vAIm9LkIlq','http://x.com/i/article/2028127373431078912',1,'工程师，开始给 Agent 打工了','https://pbs.twimg.com/media/HCVevU9bsAEkp5o.jpg','processed','2026-03-08 17:38:01','2026-03-01 23:36:57'),('2028264979024261537','interjc','分享下我平时写代码的模型选择：\n\n计划：Claude Opus 4.6\n开发：Gemini 3.1 Pro\n文档：Kimi K2.5\nBUG：GPT-5.3-Codex high\n\n主要来源是两大订阅 Chatgpt Plus 和 Google AI Pro\n\nClaude 主要靠几个 antigravity 轮流撑着，额度不足的时候掏出 any router\n\n国产模型主要靠吃百家饭养活','分享下我平时写代码的模型选择：\n\n计划：Claude Opus 4.6\n开发：Gemini 3.1 Pro\n文档：Kimi K2.5\nBUG：GPT-5.3-Codex high\n\n主要来源是两大订阅 Chatgpt Plus 和 Google AI Pro\n\nClaude 主要靠几个 antigravity 轮流撑着，额度不足的时候掏出 any router\n\n国产模型主要靠吃百家饭养活','https://x.com/interjc/status/2028264979024261537',0,'','','processed','2026-03-08 17:38:01','2026-03-02 08:23:49'),('2028308272042979347','shao__meng','CLI Is All You Need，为什么 CLI 完胜 MCP？\n\nAnthropic 推出 MCP 标准后，大量开发者开始为每一种工具、API、数据库构建专用的 MCP Server，但最顶尖的“10x 开发者”却并不采用这种方式。他们直接将终端的标准输入/输出暴露给 Agent，让 Agent 像人类开发者一样，在 Shell 中自由执行 git、grep、docker、curl、pytest 等命令，并通过管道灵活组合多个工具完成复杂任务。\n\n为什么 CLI 完胜 MCP？\n1. 上下文窗口与 Token 效率\nMCP Server 需要把完整的工具描述（方法名、参数类型、返回值结构、权限约束等）塞进提示词里，往往吃掉成百上千 token。CLI 只需一句“这是你的终端，你可以用任何 bash 命令”，模型凭借海量训练数据（几乎所有开源代码和 Stack Overflow 都充满 bash 示例）就能立即上手，上下文开销极低。\n\n2. 组合性与灵活性\nUnix 哲学的核心是“小工具 + 管道 = 强大能力”。Agent 可以用 git status | grep -i bu','CLI Is All You Need，为什么 CLI 完胜 MCP？\n\nAnthropic 推出 MCP 标准后，大量开发者开始为每一种工具、API、数据库构建专用的 MCP Server，但最顶尖的“10x 开发者”却并不采用这种方式。他们直接将终端的标准输入/输出暴露给 Agent，让 Agent 像人类开发者一样，在 Shell 中自由执行 git、grep、docker、curl、pytest 等命令，并通过管道灵活组合多个工具完成复杂任务。\n\n为什么 CLI 完胜 MCP？\n1. 上下文窗口与 Token 效率\nMCP Server 需要把完整的工具描述（方法名、参数类型、返回值结构、权限约束等）塞进提示词里，往往吃掉成百上千 token。CLI 只需一句“这是你的终端，你可以用任何 bash 命令”，模型凭借海量训练数据（几乎所有开源代码和 Stack Overflow 都充满 bash 示例）就能立即上手，上下文开销极低。\n\n2. 组合性与灵活性\nUnix 哲学的核心是“小工具 + 管道 = 强大能力”。Agent 可以用 git status | grep -i bug | xargs git add 一行解决复杂问题，而 MCP 每新增一种组合就要写新 schema、维护新 endpoint，工程量指数级上升。作者强调：现实开发中 99% 的任务都是临时性的，CLI 天生支持“即兴发挥”。\n\n3. 成熟度与可靠性\ngit、rsync、jq、ffmpeg 等工具已经经过数十年、数百万开发者的打磨和安全加固。重新用 MCP 包装它们，不仅重复劳动，还引入新的 bug 面。模型对这些工具的语义理解远超对新协议的理解。\n\n4. 开发体验与迭代速度\n给 Agent 一个干净的 Docker 容器或虚拟环境里的 Shell，配上合理的权限控制，就能让 Agent 像资深工程师一样工作。作者提到当下已有的 CLI-native Agent（如 Claude Code）在实际编码任务中表现已远超依赖繁重 MCP 的方案。\n\n开发建议：\n· 普通开发者/个人项目：直接用 CLI-first 的 Agent 框架。\n· 企业级场景：MCP 仅在需要严格审计、跨团队统一接口、或非文本工具（GUI、专有数据库）时才有价值，其余 99% 的情况 CLI 就够了。\n· 未来方向：继续完善 Shell 沙箱、安全策略和“Agent 可解释性”（让 Agent 输出每一步命令的理由），而不是继续堆叠新协议。\n\n![image](https://pbs.twimg.com/media/HCX_m_kboAA2vuC.jpg)\n','https://x.com/shao__meng/status/2028308272042979347',0,'CLI Is All You Need ','https://pbs.twimg.com/media/HA1TqQjWsAAVEAZ.jpg','processed','2026-03-08 17:38:01','2026-03-02 11:15:51'),('2028412812247323035','FinanceYF5','AI创业最贵的成本是什么？\n\n不是人，不是时间——是API费用。\n\nZ. ai 刚上线了一个Startup 项目：免费credits + 优先支持 + Early API Access\n\n已有数百家startup在用，包括Claude Code、Kiro、Goose等\n\n值不值得申请？一个Thread讲清楚? https://t.co/Jf5sb4qV6T','AI创业最贵的成本是什么？\n\n不是人，不是时间——是API费用。\n\nZ. ai 刚上线了一个Startup 项目：免费credits + 优先支持 + Early API Access\n\n已有数百家startup在用，包括Claude Code、Kiro、Goose等\n\n值不值得申请？一个Thread讲清楚? https://t.co/Jf5sb4qV6T\n\n![image](https://pbs.twimg.com/media/HCZetD1boAAGLm8.jpg)\n','https://x.com/FinanceYF5/status/2028412812247323035',0,'','','processed','2026-03-08 17:38:01','2026-03-02 18:11:15'),('2028850942121062811','BruceBlue','https://t.co/k0UCHNrAxq','https://t.co/k0UCHNrAxq','http://x.com/i/article/2028846263157092352',1,'把 MiniMax 调教成“免费 Claude”：我花 3 天 40+ 次亲测的完整方法','https://pbs.twimg.com/media/HCfpE9DbgAAK5zZ.jpg','processed','2026-03-08 17:38:01','2026-03-03 23:12:13'),('2028998826699415561','shao__meng','九个月使用 Claude Code 作为主力开发工具后，@boristane 分享了他提炼出来的完整工作流，一起看看这位前 Cloudflare 工程师是怎么做的，他现在在做 nominal. dev，要把所有 on-call 的工程师都解放出来，期待！\n\n最重要的一个观点：\n规划与执行的严格分离，绝不让 Claude 在你审查并批准书面计划之前写一行代码。\n\n整体工作流程\nResearch → Plan → Annotate（反复） → Todo List → Implement → Feedback & Iterate\n\n1. 深度研究（Research）\n任何任务先要求 Claude 对代码库相关部分进行“深读”。必须输出到持久文件 https://t.co/hYqNwtIyAO，而非聊天总结。 \n关键提示词：deeply、in great details、intricacies、go through everything。 \n目的：验证 Claude 是否真正理解系统，避免后续“孤立有效、整体破坏”的最昂贵失败模式（如忽略缓存层、违反 ORM 约定、重复已有逻辑）。\n\n2. 规','九个月使用 Claude Code 作为主力开发工具后，@boristane 分享了他提炼出来的完整工作流，一起看看这位前 Cloudflare 工程师是怎么做的，他现在在做 nominal. dev，要把所有 on-call 的工程师都解放出来，期待！\n\n最重要的一个观点：\n规划与执行的严格分离，绝不让 Claude 在你审查并批准书面计划之前写一行代码。\n\n整体工作流程\nResearch → Plan → Annotate（反复） → Todo List → Implement → Feedback & Iterate\n\n1. 深度研究（Research）\n任何任务先要求 Claude 对代码库相关部分进行“深读”。必须输出到持久文件 https://t.co/hYqNwtIyAO，而非聊天总结。 \n关键提示词：deeply、in great details、intricacies、go through everything。 \n目的：验证 Claude 是否真正理解系统，避免后续“孤立有效、整体破坏”的最昂贵失败模式（如忽略缓存层、违反 ORM 约定、重复已有逻辑）。\n\n2. 规划（Plan）\n基于研究结果，让 Claude 生成 https://t.co/iszM3tN02f，包含详细方案、代码片段建议、文件路径、权衡考量。\nBoris 强烈推荐自定义 Markdown 文件，而非 Claude 内置的 plan mode。\n\n3. 标注迭代（Annotation Cycle）——最核心的价值注入环节\n在本地编辑器中打开 https://t.co/iszM3tN02f，直接添加内联注释：纠正假设、注入领域知识、拒绝方案、指定约束等。 \n示例注释：\n· “use drizzle:generate for migrations, not raw SQL”\n· “no — this should be a PATCH, not a PUT”\n· “remove this section entirely, we don’t need caching here” \n然后发给 Claude：“我添加了注释，请全部处理并更新文档，don’t implement yet。” 循环 1-6 次，直至计划完美适配项目上下文。此阶段才是真正的“思考”与“判断”。\n\n4. 生成 Todo 清单\n要求 Claude 在 https://t.co/iszM3tN02f 中添加颗粒度极细的任务分解，作为执行进度追踪器。\n\n5. 一次性实施（Implement）\n使用标准化提示：\nimplement it all. when you’re done with a task or phase, mark it as completed in the plan document. do not stop until all tasks and phases are completed. do not add unnecessary comments or jsdocs, do not use any or unknown types. continuously run typecheck...\n实施被设计为“机械化、无聊”的执行过程——创造性工作已在标注阶段完成。\n\n6. 反馈与微调\n实施中反馈极简（单句或截图）：“wider”“still cropped”“You didn’t implement the deduplicateByTitle function.” \n若方向错误，直接 Git revert 后重新限定范围，而非修补。\n\n博客地址\nhttps://t.co/gnNgM1LlS5\n\n![image](https://pbs.twimg.com/media/HChzq6SawAEEwu_.jpg)\n','https://x.com/shao__meng/status/2028998826699415561',0,'','','processed','2026-03-08 17:38:01','2026-03-04 08:59:52'),('2029433337895653466','xds2000','https://t.co/NYJAA6ahSF','https://t.co/NYJAA6ahSF','http://x.com/i/article/2029431258162593792',1,'Perplexity Computer 深度解析：Sandbox Matrix 维护机制与快速任务执行的技术内幕','https://pbs.twimg.com/media/HCn9hALbsAEjIlf.jpg','processed','2026-03-08 17:38:01','2026-03-05 13:46:27'),('2029596431250841754','boniusex','https://t.co/CNdwxDP16z','https://t.co/CNdwxDP16z','http://x.com/i/article/2029595999006826496',1,'openclaw 你学会了，那么全网最细的 Notebooklm 你会操作了吗','https://pbs.twimg.com/media/HCqS28UaUAIdJ8E.jpg','processed','2026-03-08 17:38:01','2026-03-06 00:34:32'),('2029664201107722516','Paiqi_Peccy','https://t.co/120NXHvJuW','https://t.co/120NXHvJuW','http://x.com/i/article/2029622316355776512',1,'GPT-5.4 Prompt Guidance首发解读： 告别“抽卡”时代','https://pbs.twimg.com/media/HCrQNIVW4AAVlOK.jpg','processed','2026-03-08 17:38:01','2026-03-06 05:03:50'),('2029748928091148665','yanhua1010','https://t.co/LDH4maliO3','https://t.co/LDH4maliO3','http://x.com/i/article/2029743552650170370',1,'Claude 终极入门指南：100 小时实测，一篇讲透','https://pbs.twimg.com/media/HCsZBjRaUAIVrgA.jpg','processed','2026-03-08 17:38:01','2026-03-06 10:40:30'),('2029851505583607961','jiayuan_jy','https://t.co/5VVKV7bChf','https://t.co/5VVKV7bChf','http://x.com/i/article/2029834685690613760',1,'当我们站在变革的开端','https://pbs.twimg.com/media/HCt4MYza8AEtLpF.jpg','processed','2026-03-08 17:38:01','2026-03-06 17:28:06'),('2030104926672843064','xiongchun007','GitHub 上爆火的 NanoClaw 彻底刷屏, 更安全、更精简的 OpenClaw“容器版”。\n\n有了 NanoClaw ，可以不再让你的 AI 代理在系统里裸奔了，也不用担心它悄悄给你拆家了。\n\n?默认全容器化运行！Agent 所有的操作都被关在“沙箱”里。想删我根目录？门儿都没有！\n\n?代码仅 4000 行： 极简主义巅峰。代码少意味着漏洞少、易审计。Karpathy 说这代码量“人脑和 AI 都能秒懂”，这才是优雅的工程实践。 \n\n?大厂背书： 基于 Anthropic 的 Agent SDK 深度优化，速度快、稳定性强，开源社区反响极热。\n\n我试了一下，非常简单。感觉不需要去腾讯云大楼下面排队找人安装了。\n\nhttps://t.co/Rup7RASh1U','GitHub 上爆火的 NanoClaw 彻底刷屏, 更安全、更精简的 OpenClaw“容器版”。\n\n有了 NanoClaw ，可以不再让你的 AI 代理在系统里裸奔了，也不用担心它悄悄给你拆家了。\n\n?默认全容器化运行！Agent 所有的操作都被关在“沙箱”里。想删我根目录？门儿都没有！\n\n?代码仅 4000 行： 极简主义巅峰。代码少意味着漏洞少、易审计。Karpathy 说这代码量“人脑和 AI 都能秒懂”，这才是优雅的工程实践。 \n\n?大厂背书： 基于 Anthropic 的 Agent SDK 深度优化，速度快、稳定性强，开源社区反响极热。\n\n我试了一下，非常简单。感觉不需要去腾讯云大楼下面排队找人安装了。\n\nhttps://t.co/Rup7RASh1U','https://x.com/xiongchun007/status/2030104926672843064',0,'NanoClaw - Secure AI Agent for WhatsApp, Telegram & More','https://pbs.twimg.com/card_img/2030015740980432897/ASzfi06s?format=jpg&name=600x600','processed','2026-03-08 17:38:01','2026-03-07 10:15:07'),('2030244724389584950','boniusex','https://t.co/qmzZSVuItx','https://t.co/qmzZSVuItx','http://x.com/i/article/2030243670826631168',1,'你用 Claude 的方式，可能从一开始就错了 ','https://pbs.twimg.com/media/HCzgxs7agAAS0ml.jpg','processed','2026-03-08 17:38:01','2026-03-07 19:30:37'),('2030462855099847105','geekbb','能省这么多 token 吗，是在 Claude Code 前面再加一层代理做过滤、压缩和重组，把更短的结果送进模型上下文。主打收益是 token 消耗降低约 60% 到 90%，使用 Rust 实现，零依赖和低于 10ms 的额外开销。 https://t.co/RWsh2BOWSr','能省这么多 token 吗，是在 Claude Code 前面再加一层代理做过滤、压缩和重组，把更短的结果送进模型上下文。主打收益是 token 消耗降低约 60% 到 90%，使用 Rust 实现，零依赖和低于 10ms 的额外开销。 https://t.co/RWsh2BOWSr\n\n![image](https://pbs.twimg.com/media/HC2lxE1a8AA90g_.jpg)\n','https://x.com/geekbb/status/2030462855099847105',0,'','','pending','2026-03-08 17:38:01','2026-03-08 09:57:23'),('2030633103233020349','AYi_AInotes','https://t.co/cL9GXHRceb','https://t.co/cL9GXHRceb','https://github.com/affaan-m/everything-claude-code',1,'GitHub - affaan-m/everything-claude-code: The agent harness performance optimization system....','https://pbs.twimg.com/card_img/2028561961441792000/RIce5mZf?format=jpg&name=600x600','pending','2026-03-08 23:47:15','2026-03-08 21:13:54'),('2030647797586993304','berryxia','兄弟们！?这个太顶了！\n\nGithub 上的 Edit Banana这个开源项目太顶了！！！\n今日登上热榜，直接斩获2800Star！\n\n把AI生成的死图、流程图、架构图、PDF统计图、公式图，一键秒变完全可编辑的 DrawIO / SVG / PPTX！\n\n使用SAM3精准分割 + 本地OCR + 多模态LLM，颜色、箭头、层级、LaTeX公式全1:1还原，随便拖拽改样式！\n\n再也不用对着截图重做了，生产力直接起飞～\n\n兄弟们，地址见评论区！\n\n快去试试，谁用谁香！','兄弟们！?这个太顶了！\n\nGithub 上的 Edit Banana这个开源项目太顶了！！！\n今日登上热榜，直接斩获2800Star！\n\n把AI生成的死图、流程图、架构图、PDF统计图、公式图，一键秒变完全可编辑的 DrawIO / SVG / PPTX！\n\n使用SAM3精准分割 + 本地OCR + 多模态LLM，颜色、箭头、层级、LaTeX公式全1:1还原，随便拖拽改样式！\n\n再也不用对着截图重做了，生产力直接起飞～\n\n兄弟们，地址见评论区！\n\n快去试试，谁用谁香！\n\n![image](https://pbs.twimg.com/media/HC5PZXhbwAAbLwT.jpg)\n','https://x.com/berryxia/status/2030647797586993304',0,'','','pending','2026-03-08 23:47:15','2026-03-08 22:12:17'),('2030683220438663417','Pluvio9yte','https://t.co/FAyQ2yjsuO','https://t.co/FAyQ2yjsuO','http://x.com/i/article/2030680713381527552',1,'Claude Opus 4.6 vs GPT-5.4，谁是前端开发的终极王者','https://pbs.twimg.com/media/HC5vgN1acAAph_s.jpg','processed','2026-03-08 23:47:15','2026-03-09 00:33:03'),('2030885885395574914','QingQ77','Sub2API  一个把 AI 订阅额度做成可管理 API 网关的开源项目\n\n  → 这不是普通中转壳子，是自托管的“AI 配额分发后台”。\n  → 它把多账号调度、API Key 分发、Token 级计费、并发限速这些脏活一次补齐了。\n  → 如果你在做团队共享、拼车分摊、统一上游出口，这项目确实值得点开。\n  → 连 OpenAI Responses 兼容细节和 Claude Code 已知问题都写了，明显是踩过坑的人在做。\n  → 代价也很明确：要 PostgreSQL + Redis，定位不是轻量脚本，而是能长期跑的管理系统。\n\nhttps://t.co/GHjerPuyTz','Sub2API  一个把 AI 订阅额度做成可管理 API 网关的开源项目\n\n  → 这不是普通中转壳子，是自托管的“AI 配额分发后台”。\n  → 它把多账号调度、API Key 分发、Token 级计费、并发限速这些脏活一次补齐了。\n  → 如果你在做团队共享、拼车分摊、统一上游出口，这项目确实值得点开。\n  → 连 OpenAI Responses 兼容细节和 Claude Code 已知问题都写了，明显是踩过坑的人在做。\n  → 代价也很明确：要 PostgreSQL + Redis，定位不是轻量脚本，而是能长期跑的管理系统。\n\nhttps://t.co/GHjerPuyTz','https://t.co/GHjerPuyTz',1,'GitHub - Wei-Shaw/sub2api: Sub2API-CRS2 一站式开源中转服务，让 Claude、Openai 、Gemini、Antigravity订阅统一接入，支持拼车共...','https://pbs.twimg.com/card_img/2031018825022369792/mQkWQdM1?format=jpg&name=600x600','pending','2026-03-09 23:47:17','2026-03-09 13:58:22'),('2030946711200584056','0xsatorisan','https://t.co/EUxwK1Na4w','https://t.co/EUxwK1Na4w','http://x.com/i/article/2030940477374320640',1,'我在 DGX Spark 上测试了 来自4个国家的8 个本地大模型。这不是中国 vs. 美国之争 ，而是QWen碾压所有人','https://pbs.twimg.com/media/HC9aCNjakAA3M0h.jpg','processed','2026-03-09 17:47:18','2026-03-09 18:00:04');
/*!40000 ALTER TABLE `info_bookmarks` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `info_items`
--

DROP TABLE IF EXISTS `info_items`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `info_items` (
  `id` int NOT NULL AUTO_INCREMENT,
  `bookmark_id` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `title` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `category` enum('news','article') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `summary` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `author` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `oss_path` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `cover_image` varchar(1024) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT '',
  `view_count` int unsigned NOT NULL DEFAULT '0' COMMENT '阅读次数',
  `viewers` json DEFAULT NULL COMMENT '阅读人员列表 [{"uid":"...","realName":"..."}]',
  `published_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `bookmark_id` (`bookmark_id`),
  CONSTRAINT `info_items_ibfk_1` FOREIGN KEY (`bookmark_id`) REFERENCES `info_bookmarks` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=139 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

DROP TABLE IF EXISTS `review_flow_templates`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `review_flow_templates` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '主键',
  `name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '流程名称',
  `review_type` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '审阅类型: 对外发文/内部公文/投票表决等',
  `sub_type` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '子类型: 公司制度/部门规章/通知公告/法务合规',
  `target_category` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '默认归档栏目: company/department/product/knowledge',
  `nodes` json NOT NULL COMMENT '审批节点配置数组',
  `status` tinyint NOT NULL DEFAULT '1' COMMENT '状态: 1=启用, 0=禁用',
  `created_by` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '创建人UID',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `idx_review_type` (`review_type`,`sub_type`,`status`)
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='审批流程模板表';
/*!40101 SET character_set_client = @saved_cs_client */;


SET FOREIGN_KEY_CHECKS = 1;

-- 部门共享文档表
DROP TABLE IF EXISTS `department_shares`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `department_shares` (
  `id` int unsigned NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `document_id` int unsigned NOT NULL COMMENT '文档ID，关联 documents 表',
  `from_dept_code` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '共享方部门代码',
  `dept_code` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '接收方部门代码',
  `shared_by` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '共享操作人 UID',
  `status` enum('pending','accepted','rejected') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending' COMMENT '共享状态：pending-待处理，accepted-已接受，rejected-已拒绝',
  `message` text COLLATE utf8mb4_unicode_ci COMMENT '共享说明或拒绝理由',
  `handled_by` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '处理人 UID',
  `handled_at` datetime DEFAULT NULL COMMENT '处理时间',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `idx_document_id` (`document_id`),
  KEY `idx_dept_code_status` (`dept_code`,`status`),
  KEY `idx_from_dept_code` (`from_dept_code`),
  KEY `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='部门共享文档表';
/*!40101 SET character_set_client = @saved_cs_client */;


-- 1. 审批流程模板表
CREATE TABLE IF NOT EXISTS `review_flow_templates` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `name` VARCHAR(100) NOT NULL COMMENT '流程名称',
  `review_type` VARCHAR(50) NOT NULL COMMENT '审阅类型: 对外发文/内部公文/投票表决等',
  `sub_type` VARCHAR(50) NULL COMMENT '子类型: 公司制度/部门规章/通知公告/法务合规',
  `target_category` VARCHAR(50) NOT NULL COMMENT '默认归档栏目: company/department/product/knowledge',
  `nodes` JSON NOT NULL COMMENT '审批节点配置数组',
  `status` TINYINT NOT NULL DEFAULT 1 COMMENT '状态: 1=启用, 0=禁用',
  `created_by` VARCHAR(50) NOT NULL COMMENT '创建人UID',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  INDEX `idx_review_type` (`review_type`, `sub_type`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='审批流程模板表';

-- 2. 文档审阅记录表
CREATE TABLE IF NOT EXISTS `document_reviews` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `document_id` BIGINT UNSIGNED NOT NULL COMMENT '文档ID',
  `document_uuid` VARCHAR(36) NOT NULL COMMENT '文档UUID',
  `template_id` BIGINT UNSIGNED NOT NULL COMMENT '使用的模板ID',
  `review_type` VARCHAR(50) NOT NULL COMMENT '审阅类型',
  `sub_type` VARCHAR(50) NULL COMMENT '子类型',
  `initiator_uid` VARCHAR(50) NOT NULL COMMENT '发起人UID',
  `target_category` VARCHAR(50) NOT NULL COMMENT '归档目标栏目',
  `status` ENUM('pending', 'in_progress', 'approved', 'rejected', 'archived') NOT NULL DEFAULT 'in_progress' COMMENT '审阅状态',
  `current_node` INT NOT NULL DEFAULT 0 COMMENT '当前审批节点序号',
  `flow_snapshot` JSON NOT NULL COMMENT '流程快照(含解析后的具体审阅人)',
  `review_oss_path` VARCHAR(500) NULL COMMENT '审阅期间文档OSS路径(codocs/reviews/)',
  `archive_oss_path` VARCHAR(500) NULL COMMENT '发布后文档OSS路径',
  `execution_status` VARCHAR(30) NULL COMMENT '发布后执行状态：pending_seal/pending_send/pending_receive/sent/received',
  `published_document_uuid` VARCHAR(36) NULL COMMENT '发布版本文档UUID',
  `sealed_at` DATETIME NULL COMMENT '确认盖章时间',
  `sent_at` DATETIME NULL COMMENT '确认发送时间',
  `received_at` DATETIME NULL COMMENT '确认接收时间',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  INDEX `idx_document_uuid` (`document_uuid`),
  INDEX `idx_document_id` (`document_id`),
  INDEX `idx_initiator` (`initiator_uid`, `status`),
  INDEX `idx_status` (`status`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='文档审阅记录表';

-- 2.1 文档发布申请表（新 Workflow 审批链路）
CREATE TABLE IF NOT EXISTS `document_publish_requests` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `document_id` BIGINT UNSIGNED NOT NULL COMMENT '源文档ID',
  `document_uuid` VARCHAR(36) NOT NULL COMMENT '源文档UUID',
  `review_type` VARCHAR(50) NOT NULL COMMENT '发布类型',
  `sub_type` VARCHAR(50) NULL COMMENT '子类型',
  `initiator_uid` VARCHAR(64) NOT NULL COMMENT '发起人UID',
  `target_category` VARCHAR(50) NOT NULL COMMENT '归档目标',
  `extra` JSON NULL COMMENT '对外发文等扩展字段',
  `review_oss_path` VARCHAR(500) NULL COMMENT '审批快照OSS路径',
  `workflow_instance_id` BIGINT UNSIGNED NULL COMMENT 'Workflow实例ID',
  `workflow_instance_no` VARCHAR(30) NULL COMMENT 'Workflow实例编号',
  `workflow_status` ENUM('draft','running','approved','rejected','cancelled') NOT NULL DEFAULT 'draft',
  `archive_oss_path` VARCHAR(500) NULL COMMENT '发布后文档OSS路径',
  `execution_status` VARCHAR(30) NULL COMMENT '发布后执行状态',
  `published_document_uuid` VARCHAR(36) NULL COMMENT '发布版本文档UUID',
  `sealed_at` DATETIME NULL COMMENT '确认盖章时间',
  `sent_at` DATETIME NULL COMMENT '确认发送时间',
  `received_at` DATETIME NULL COMMENT '确认接收时间',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_document_uuid` (`document_uuid`),
  INDEX `idx_workflow_instance` (`workflow_instance_id`),
  INDEX `idx_initiator_status` (`initiator_uid`, `workflow_status`),
  INDEX `idx_status_created` (`workflow_status`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='文档发布申请表';

-- 3. 审阅操作记录表
CREATE TABLE IF NOT EXISTS `review_actions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `review_id` BIGINT UNSIGNED NOT NULL COMMENT '审阅记录ID',
  `node_index` INT NOT NULL COMMENT '节点序号',
  `actor_uid` VARCHAR(50) NOT NULL COMMENT '操作人UID',
  `action` ENUM('approve', 'reject', 'remind') NOT NULL COMMENT '操作类型: approve=通过, reject=驳回, remind=提醒',
  `comment` TEXT NULL COMMENT '意见或驳回原因',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '操作时间',
  PRIMARY KEY (`id`),
  INDEX `idx_review_id` (`review_id`, `node_index`),
  INDEX `idx_actor` (`actor_uid`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='审阅操作记录表';

-- 3.1 盖章记录表
CREATE TABLE IF NOT EXISTS `document_seal_records` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `review_id` BIGINT UNSIGNED NOT NULL COMMENT '关联审阅ID；新Workflow链路中为发布申请ID',
  `document_uuid` VARCHAR(36) NOT NULL COMMENT '发布版本文档UUID',
  `seal_types` JSON NOT NULL COMMENT '盖章类型数组',
  `page_count` INT NOT NULL COMMENT '文档页数',
  `operator_uid` VARCHAR(64) NOT NULL COMMENT '盖章确认人',
  `remark` VARCHAR(500) DEFAULT NULL COMMENT '备注',
  `confirmed_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '确认盖章时间',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  INDEX `idx_review_id` (`review_id`),
  INDEX `idx_document_uuid` (`document_uuid`),
  INDEX `idx_operator_uid` (`operator_uid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='文档盖章记录表';

-- 3.2 发送记录表
CREATE TABLE IF NOT EXISTS `document_send_records` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `review_id` BIGINT UNSIGNED NOT NULL COMMENT '关联审阅ID；新Workflow链路中为发布申请ID',
  `document_uuid` VARCHAR(36) NOT NULL COMMENT '发布版本文档UUID',
  `sender_uid` VARCHAR(64) NOT NULL COMMENT '发送人',
  `receiver_name` VARCHAR(100) NOT NULL COMMENT '接收人',
  `receiver_phone` VARCHAR(30) NOT NULL COMMENT '联系电话',
  `channel` VARCHAR(20) NOT NULL COMMENT '发送途径：email/wecom/wechat/qq/usb',
  `sent_date` DATE NULL COMMENT '实际发送日期',
  `receive_date` DATE NULL COMMENT '实际接收日期',
  `target_account` VARCHAR(200) DEFAULT NULL COMMENT '对方账号，U盘时为空',
  `remark` VARCHAR(500) DEFAULT NULL COMMENT '备注',
  `confirmed_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '确认发送时间',
  `received_confirmed_at` DATETIME NULL COMMENT '确认接收时间',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  INDEX `idx_review_id` (`review_id`),
  INDEX `idx_document_uuid` (`document_uuid`),
  INDEX `idx_sender_uid` (`sender_uid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='文档发送记录表';

-- -----------------------------------------------------------
-- 文件柜文件夹表
-- -----------------------------------------------------------
DROP TABLE IF EXISTS `cabinet_folders`;
CREATE TABLE `cabinet_folders` (
    `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY COMMENT '文件夹ID',
    `name` VARCHAR(255) NOT NULL COMMENT '文件夹名称',
    `parent_id` BIGINT UNSIGNED NULL COMMENT '父文件夹ID(NULL表示根目录)',
    `owner_uid` VARCHAR(64) NOT NULL COMMENT '创建人用户名',
    `dept_code` VARCHAR(100) NULL COMMENT '所属部门编码(NULL表示个人文件柜)',
    `sort_order` INT NOT NULL DEFAULT 0 COMMENT '排序序号',
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    INDEX `idx_cabinet_folders_dept` (`dept_code`),
    INDEX `idx_cabinet_folders_parent` (`parent_id`),
    INDEX `idx_cabinet_folders_owner` (`owner_uid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='文件柜文件夹表';

-- -----------------------------------------------------------
-- 文件柜表 (非 Markdown 文档存储)
-- -----------------------------------------------------------
DROP TABLE IF EXISTS `cabinet_files`;
CREATE TABLE `cabinet_files` (
    `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY COMMENT '文件ID',
    `uuid` CHAR(36) NOT NULL COMMENT '文件UUID',
    `filename` VARCHAR(255) NOT NULL COMMENT '文件名(去除特殊字符后)',
    `original_name` VARCHAR(255) NOT NULL COMMENT '原始文件名',
    `file_ext` VARCHAR(20) NOT NULL COMMENT '文件扩展名',
    `file_size` BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '文件大小(字节)',
    `oss_path` VARCHAR(500) NOT NULL COMMENT 'OSS存储路径',
    `owner_uid` VARCHAR(64) NOT NULL COMMENT '所有者用户名(上传人)',
    `dept_code` VARCHAR(20) NULL COMMENT '所属部门编码(NULL表示个人文件柜)',
    `folder_id` BIGINT UNSIGNED NULL COMMENT '所属文件夹ID(预留)',
    `converted_doc_uuid` CHAR(36) NULL COMMENT '转存后的文档UUID(关联documents.uuid)',
    `status` TINYINT NOT NULL DEFAULT 1 COMMENT '状态: 1-正常 0-已删除',
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    `deleted_at` DATETIME NULL COMMENT '删除时间',

    UNIQUE KEY `uk_cabinet_uuid` (`uuid`),
    INDEX `idx_cabinet_owner` (`owner_uid`),
    INDEX `idx_cabinet_dept` (`dept_code`),
    INDEX `idx_cabinet_status` (`status`),
    INDEX `idx_cabinet_folder` (`folder_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='文件柜表';
