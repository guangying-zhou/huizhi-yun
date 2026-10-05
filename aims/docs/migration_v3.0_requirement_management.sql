-- ========================================================================
-- Aims · 需求管理模块迁移 (v3.0)
-- 日期: 2026-04-12
-- 说明: 新增独立需求管理体系，将需求从 work_items 中解耦为一等公民
-- ========================================================================

-- ------------------------------------------------------------------------
-- 1. project_documents 增加规格书导入相关列
-- ------------------------------------------------------------------------
ALTER TABLE `project_documents`
  ADD COLUMN `import_mode` ENUM('category','flat') DEFAULT NULL
    COMMENT '需求规格书导入模式: category=分类(H2+H3+H4), flat=平铺(H2+H3)',
  ADD COLUMN `heading_levels` VARCHAR(16) DEFAULT NULL
    COMMENT '使用的标题层级，如 "2,3" 或 "3,4"',
  ADD COLUMN `import_status` ENUM('not_imported','imported_clean','imported_dirty','imported_locked') DEFAULT NULL
    COMMENT '需求规格书导入状态: not_imported/imported_clean/imported_dirty/imported_locked';

-- ------------------------------------------------------------------------
-- 2. project_counters 增加需求编号计数器
-- ------------------------------------------------------------------------
ALTER TABLE `project_counters`
  ADD COLUMN `req_counter` INT UNSIGNED NOT NULL DEFAULT 0
    COMMENT '需求项编号计数器(REQ-001)';

-- ------------------------------------------------------------------------
-- 3. 章节内容表（规格书的结构与正���）
-- ------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `requirement_contents` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `parent_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '父章节ID，根章节为 NULL',
  `heading_depth` TINYINT UNSIGNED NOT NULL COMMENT '标题层级 2/3/4',
  `title` VARCHAR(500) NOT NULL COMMENT '章���标题（不含编号前缀）',
  `content_md` MEDIUMTEXT DEFAULT NULL COMMENT '本章节正文（Markdown），不包含子章节',
  `sort_order` INT NOT NULL DEFAULT 0 COMMENT '同级章节顺序，导出时按此生成编号',
  `status` ENUM('imported','modified','deprecated') NOT NULL DEFAULT 'imported'
    COMMENT '章节状态: imported=初始导入, modified=系统内修改过, deprecated=已废弃',
  `requirement_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '关联的需求项ID（叶子或合并节点指向需求；结构父节点为 NULL）',
  `created_by` VARCHAR(64) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_by` VARCHAR(64) DEFAULT NULL,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_req_content_project_parent` (`project_id`, `parent_id`, `sort_order`),
  KEY `idx_req_content_requirement` (`requirement_id`),
  KEY `idx_req_content_project_status` (`project_id`, `status`),
  CONSTRAINT `fk_req_content_project` FOREIGN KEY (`project_id`) REFERENCES `aims_projects` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_req_content_parent` FOREIGN KEY (`parent_id`) REFERENCES `requirement_contents` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='需求规格书章节内容';

-- ------------------------------------------------------------------------
-- 4. 需求项主表
-- ------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `requirement_items` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `req_number` INT UNSIGNED NOT NULL COMMENT '项目内自增编号',
  `req_code` VARCHAR(32) NOT NULL COMMENT '显示编号，如 REQ-001',
  `title` VARCHAR(500) NOT NULL,
  `type` ENUM('functional','non_functional') NOT NULL DEFAULT 'functional' COMMENT '需求类型',
  `category` VARCHAR(64) DEFAULT NULL COMMENT '非功能子类: performance/security/usability/compatibility/...',
  `priority` ENUM('P0','P1','P2','P3') NOT NULL DEFAULT 'P2',
  `source` ENUM('customer','internal','compliance','regulation','other') NOT NULL DEFAULT 'internal' COMMENT '需��来源',
  `milestone_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '预计里程碑（软关联，创建任务时带入）',
  `status` ENUM('draft','in_review','baselined','change_pending','deprecated') NOT NULL DEFAULT 'draft'
    COMMENT '状态: draft=草稿, in_review=评审中, baselined=已基线, change_pending=变更评审中, deprecated=已废弃',
  `current_version` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '当前生效版本号，0=尚未基线',
  `baselined_at` DATETIME DEFAULT NULL COMMENT '首次基线时间',
  `created_by` VARCHAR(64) NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_by` VARCHAR(64) DEFAULT NULL,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_req_code` (`req_code`),
  UNIQUE KEY `uk_project_req_number` (`project_id`, `req_number`),
  KEY `idx_req_project_status` (`project_id`, `status`),
  KEY `idx_req_project_type` (`project_id`, `type`),
  KEY `idx_req_milestone` (`milestone_id`),
  CONSTRAINT `fk_req_item_project` FOREIGN KEY (`project_id`) REFERENCES `aims_projects` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_req_item_milestone` FOREIGN KEY (`milestone_id`) REFERENCES `milestones` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='需���项';

-- requirement_contents.requirement_id FK（延迟创建，因为 requirement_items 表刚建）
ALTER TABLE `requirement_contents`
  ADD CONSTRAINT `fk_req_content_requirement` FOREIGN KEY (`requirement_id`) REFERENCES `requirement_items` (`id`) ON DELETE SET NULL;

-- ------------------------------------------------------------------------
-- 5. 需求项版本快照表
-- ------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `requirement_versions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `requirement_id` BIGINT UNSIGNED NOT NULL,
  `version_no` INT UNSIGNED NOT NULL COMMENT '版本号 1, 2, 3...',
  `snapshot_json` JSON NOT NULL COMMENT '需求项全字段快照 + 关联章节ID列表',
  `change_type` ENUM('baseline','add','modify','delete','restore') NOT NULL COMMENT '变更类型',
  `change_reason` TEXT DEFAULT NULL COMMENT '变更原因',
  `batch_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '所属评审批次',
  `approval_workflow_id` VARCHAR(128) DEFAULT NULL COMMENT 'Workflow 实例 ID',
  `approved_by` VARCHAR(64) DEFAULT NULL,
  `approved_at` DATETIME DEFAULT NULL,
  `created_by` VARCHAR(64) NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_req_version` (`requirement_id`, `version_no`),
  KEY `idx_req_version_batch` (`batch_id`),
  CONSTRAINT `fk_req_version_item` FOREIGN KEY (`requirement_id`) REFERENCES `requirement_items` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='需求项版本快照';

-- ------------------------------------------------------------------------
-- 6. 评审批次表
-- ------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `requirement_review_batches` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `batch_type` ENUM('baseline','change') NOT NULL COMMENT 'baseline=首次基线评审, change=变更评审',
  `title` VARCHAR(255) NOT NULL COMMENT '评审批次标题',
  `description` TEXT DEFAULT NULL,
  `requirement_ids_json` JSON NOT NULL COMMENT '本次评审涉及的需求ID列表',
  `status` ENUM('pending','approved','rejected','withdrawn') NOT NULL DEFAULT 'pending',
  `workflow_instance_id` VARCHAR(128) DEFAULT NULL,
  `submitted_by` VARCHAR(64) NOT NULL,
  `submitted_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `closed_at` DATETIME DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_req_batch_project_status` (`project_id`, `status`),
  KEY `idx_req_batch_workflow` (`workflow_instance_id`),
  CONSTRAINT `fk_req_batch_project` FOREIGN KEY (`project_id`) REFERENCES `aims_projects` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='需求评��批次';

-- requirement_versions.batch_id FK
ALTER TABLE `requirement_versions`
  ADD CONSTRAINT `fk_req_version_batch` FOREIGN KEY (`batch_id`) REFERENCES `requirement_review_batches` (`id`) ON DELETE SET NULL;

-- ------------------------------------------------------------------------
-- 7. work_items 增加需求关联列
-- ------------------------------------------------------------------------
ALTER TABLE `work_items`
  ADD COLUMN `requirement_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '关联的需求项ID' AFTER `requirement_category`,
  ADD COLUMN `change_request_of` BIGINT UNSIGNED DEFAULT NULL COMMENT '变更任务指向原任务ID' AFTER `requirement_id`;

ALTER TABLE `work_items`
  ADD KEY `idx_work_item_requirement` (`requirement_id`),
  ADD KEY `idx_work_item_change_request` (`change_request_of`),
  ADD CONSTRAINT `fk_work_item_requirement` FOREIGN KEY (`requirement_id`) REFERENCES `requirement_items` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_work_item_change_request` FOREIGN KEY (`change_request_of`) REFERENCES `work_items` (`id`) ON DELETE SET NULL;

-- ------------------------------------------------------------------------
-- 8. work_items.type 增加 change_request 枚举值
-- ------------------------------------------------------------------------
ALTER TABLE `work_items`
  MODIFY COLUMN `type` ENUM('requirement','task','bug','change_request') NOT NULL;
