-- ============================================================
-- Migration v2.2: 项目模板版本化
-- ============================================================
-- 变更说明:
--   1. 新增项目模板集 / 模板版本表，支持 draft / published / archived
--   2. aims_projects 绑定模板集与模板版本
--   3. milestones / work_items / deliverables 增加 template_key
--   4. work_items 增加 required，支持模板必选工作项
-- ============================================================

USE `hzy_aims`;

-- 1. 项目模板集
CREATE TABLE IF NOT EXISTS `project_template_sets` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(100) NOT NULL COMMENT '模板集编码(同分类内可读短码)',
  `name` VARCHAR(200) NOT NULL COMMENT '模板集名称',
  `category` ENUM('product_dev','custom_dev','delivery','maintenance','sales','presales','improvement','compliance') NOT NULL COMMENT '适用项目分类',
  `description` TEXT DEFAULT NULL COMMENT '模板集说明',
  `is_system` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否系统内置模板集',
  `created_by` VARCHAR(64) NOT NULL COMMENT '创建人uid',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_project_template_set_code` (`code`),
  KEY `idx_project_template_set_category` (`category`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='项目模板集';

-- 2. 项目模板版本
CREATE TABLE IF NOT EXISTS `project_template_versions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `template_set_id` BIGINT UNSIGNED NOT NULL COMMENT '所属模板集',
  `version_no` INT UNSIGNED NOT NULL COMMENT '版本序号(模板集内递增)',
  `version_label` VARCHAR(100) NOT NULL COMMENT '版本标签(如 v1 / 2026Q2)',
  `status` ENUM('draft','published','archived') NOT NULL DEFAULT 'draft' COMMENT '版本状态',
  `notes` TEXT DEFAULT NULL COMMENT '版本说明',
  `definition_json` JSON NOT NULL COMMENT '模板定义快照(JSON, 含里程碑/工作项/交付物要求)',
  `published_at` DATETIME DEFAULT NULL COMMENT '发布时间',
  `published_by` VARCHAR(64) DEFAULT NULL COMMENT '发布人uid',
  `archived_at` DATETIME DEFAULT NULL COMMENT '归档时间',
  `archived_by` VARCHAR(64) DEFAULT NULL COMMENT '归档人uid',
  `created_by` VARCHAR(64) NOT NULL COMMENT '创建人uid',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_project_template_version` (`template_set_id`, `version_no`),
  KEY `idx_project_template_version_status` (`status`),
  CONSTRAINT `fk_project_template_version_set` FOREIGN KEY (`template_set_id`) REFERENCES `project_template_sets` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='项目模板版本';

-- 3. aims_projects 绑定模板版本
ALTER TABLE `aims_projects`
  ADD COLUMN `template_set_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '绑定的项目模板集' AFTER `workflow_instance_id`,
  ADD COLUMN `template_version_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '绑定的项目模板版本' AFTER `template_set_id`,
  ADD KEY `idx_template_set_id` (`template_set_id`),
  ADD KEY `idx_template_version_id` (`template_version_id`),
  ADD CONSTRAINT `fk_project_template_set` FOREIGN KEY (`template_set_id`) REFERENCES `project_template_sets` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_project_template_version` FOREIGN KEY (`template_version_id`) REFERENCES `project_template_versions` (`id`) ON DELETE SET NULL;

-- 4. 里程碑增加模板键
ALTER TABLE `milestones`
  ADD COLUMN `template_key` VARCHAR(100) DEFAULT NULL COMMENT '来源模板中的里程碑键' AFTER `pivr_stage`,
  ADD KEY `idx_milestone_project_template_key` (`project_id`, `template_key`);

-- 5. 工作项增加必选标记与模板键
ALTER TABLE `work_items`
  ADD COLUMN `required` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否模板必选工作项: 1=必选 0=可选' AFTER `review_level`,
  ADD COLUMN `template_key` VARCHAR(100) DEFAULT NULL COMMENT '来源模板中的工作项键' AFTER `required`,
  ADD KEY `idx_work_item_project_required` (`project_id`, `required`),
  ADD KEY `idx_work_item_project_template_key` (`project_id`, `template_key`);

-- 6. 交付物增加模板键
ALTER TABLE `deliverables`
  ADD COLUMN `template_key` VARCHAR(100) DEFAULT NULL COMMENT '来源模板中的交付物键' AFTER `required`,
  ADD KEY `idx_deliverable_project_template_key` (`project_id`, `template_key`);
