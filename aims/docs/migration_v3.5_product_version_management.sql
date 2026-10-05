-- Aims product version management migration
-- Run against the Aims database, for example:
--   mysql -h127.0.0.1 -uroot -p hzy_aims < aims/docs/migration_v3.5_product_version_management.sql
--
-- This migration is idempotent for table creation and for work_items column /
-- index / foreign-key additions.

CREATE TABLE IF NOT EXISTS `product_versions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `product_code` VARCHAR(64) NOT NULL COMMENT '所属产品(关联Assets product_assets.product_code)',
  `version_code` VARCHAR(64) NOT NULL COMMENT '版本号(如 v2.1.0)',
  `name` VARCHAR(200) DEFAULT NULL COMMENT '版本名称/主题(可选)',
  `description` TEXT DEFAULT NULL COMMENT '版本说明(Markdown)',
  `status` ENUM('planning','developing','released','archived') NOT NULL DEFAULT 'planning'
    COMMENT '版本状态: planning(规划)→developing(开发中)→released(已发布)→archived(归档)',
  `planned_release_date` DATE DEFAULT NULL COMMENT '计划发布日期',
  `released_at` DATETIME DEFAULT NULL COMMENT '实际发布时间',
  `released_by` VARCHAR(64) DEFAULT NULL COMMENT '发布操作人uid',
  `milestone_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '软关联里程碑(可选, 逻辑关联非外键)',
  `owner_project_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '归属项目(生命周期操作仅限该项目负责人; 逻辑关联非外键)',
  `sort_order` INT NOT NULL DEFAULT 0 COMMENT '排序(默认按版本创建倒序)',
  `created_by` VARCHAR(64) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_product_version` (`product_code`, `version_code`),
  KEY `idx_product_status` (`product_code`, `status`),
  KEY `idx_version_milestone` (`milestone_id`),
  KEY `idx_version_owner_project` (`owner_project_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='产品版本(Release)';

CREATE TABLE IF NOT EXISTS `aims_project_products` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `product_code` VARCHAR(64) NOT NULL COMMENT '关联Assets product_assets.product_code(逻辑关联, 非外键)',
  `product_name` VARCHAR(255) DEFAULT NULL COMMENT '产品名称快照(展示用, 关联时同步)',
  `version_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '限定版本(关联product_versions.id; NULL=不限版本/全版本项目)',
  `is_primary` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否主产品(项目默认版本上下文)',
  `created_by` VARCHAR(64) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_project_product` (`project_id`, `product_code`),
  UNIQUE KEY `uk_project_primary` ((CASE WHEN `is_primary` = 1 THEN `project_id` END)),
  KEY `idx_project_product_code` (`product_code`),
  KEY `idx_project_product_version` (`version_id`),
  CONSTRAINT `fk_project_product_project` FOREIGN KEY (`project_id`)
    REFERENCES `aims_projects` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_project_product_version` FOREIGN KEY (`version_id`)
    REFERENCES `product_versions` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='项目与产品资产关联';

CREATE TABLE IF NOT EXISTS `product_version_features` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `version_id` BIGINT UNSIGNED NOT NULL COMMENT '所属版本',
  `title` VARCHAR(255) NOT NULL COMMENT '特性标题(对外口径)',
  `description` TEXT DEFAULT NULL COMMENT '特性说明(Markdown, 可含客户价值描述)',
  `category` VARCHAR(64) DEFAULT NULL COMMENT '特性分类(如 新增能力/体验优化/性能/安全, 字典可后置)',
  `status` ENUM('planned','delivered','deferred') NOT NULL DEFAULT 'planned'
    COMMENT '特性状态: planned(规划)→delivered(已交付)/deferred(顺延后续版本)',
  `is_public` TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否对外可见(销售/Altoc消费时过滤)',
  `sort_order` INT NOT NULL DEFAULT 0 COMMENT '排序',
  `created_by` VARCHAR(64) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_feature_version` (`version_id`, `sort_order`),
  CONSTRAINT `fk_feature_version` FOREIGN KEY (`version_id`)
    REFERENCES `product_versions` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='产品版本功能特性清单(粗粒度, 销售/对外口径)';

CREATE TABLE IF NOT EXISTS `product_version_logs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `version_id` BIGINT UNSIGNED NOT NULL,
  `action` VARCHAR(64) NOT NULL COMMENT '操作类型',
  `old_value` TEXT DEFAULT NULL,
  `new_value` TEXT DEFAULT NULL,
  `operator_uid` VARCHAR(64) DEFAULT NULL,
  `note` VARCHAR(500) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_version_log` (`version_id`, `created_at`),
  CONSTRAINT `fk_version_log_version` FOREIGN KEY (`version_id`)
    REFERENCES `product_versions` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='产品版本操作日志';

DELIMITER $$

DROP PROCEDURE IF EXISTS `hzy_add_column_if_missing`$$
CREATE PROCEDURE `hzy_add_column_if_missing`(
  IN p_table_name VARCHAR(64),
  IN p_column_name VARCHAR(64),
  IN p_column_ddl TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = p_table_name
      AND COLUMN_NAME = p_column_name
  ) THEN
    SET @hzy_sql = CONCAT('ALTER TABLE `', p_table_name, '` ADD COLUMN ', p_column_ddl);
    PREPARE hzy_stmt FROM @hzy_sql;
    EXECUTE hzy_stmt;
    DEALLOCATE PREPARE hzy_stmt;
  END IF;
END$$

DROP PROCEDURE IF EXISTS `hzy_add_index_if_missing`$$
CREATE PROCEDURE `hzy_add_index_if_missing`(
  IN p_table_name VARCHAR(64),
  IN p_index_name VARCHAR(64),
  IN p_index_ddl TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = p_table_name
      AND INDEX_NAME = p_index_name
  ) THEN
    SET @hzy_sql = CONCAT('ALTER TABLE `', p_table_name, '` ADD ', p_index_ddl);
    PREPARE hzy_stmt FROM @hzy_sql;
    EXECUTE hzy_stmt;
    DEALLOCATE PREPARE hzy_stmt;
  END IF;
END$$

DROP PROCEDURE IF EXISTS `hzy_add_fk_if_missing`$$
CREATE PROCEDURE `hzy_add_fk_if_missing`(
  IN p_table_name VARCHAR(64),
  IN p_constraint_name VARCHAR(64),
  IN p_constraint_ddl TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = p_table_name
      AND CONSTRAINT_NAME = p_constraint_name
      AND CONSTRAINT_TYPE = 'FOREIGN KEY'
  ) THEN
    SET @hzy_sql = CONCAT('ALTER TABLE `', p_table_name, '` ADD CONSTRAINT `', p_constraint_name, '` ', p_constraint_ddl);
    PREPARE hzy_stmt FROM @hzy_sql;
    EXECUTE hzy_stmt;
    DEALLOCATE PREPARE hzy_stmt;
  END IF;
END$$

DELIMITER ;

CALL hzy_add_column_if_missing(
  'work_items',
  'version_id',
  '`version_id` BIGINT UNSIGNED DEFAULT NULL COMMENT ''目标版本(关联product_versions.id, 仅tier=target有效)'' AFTER `milestone_id`'
);

CALL hzy_add_column_if_missing(
  'work_items',
  'feature_id',
  '`feature_id` BIGINT UNSIGNED DEFAULT NULL COMMENT ''所属功能特性(关联product_version_features.id, 可选, 须与version_id同版本)'' AFTER `version_id`'
);

CALL hzy_add_index_if_missing(
  'work_items',
  'idx_work_item_version',
  'KEY `idx_work_item_version` (`version_id`)'
);

CALL hzy_add_index_if_missing(
  'work_items',
  'idx_work_item_feature',
  'KEY `idx_work_item_feature` (`feature_id`)'
);

CALL hzy_add_fk_if_missing(
  'work_items',
  'fk_work_item_version',
  'FOREIGN KEY (`version_id`) REFERENCES `product_versions` (`id`) ON DELETE SET NULL'
);

CALL hzy_add_fk_if_missing(
  'work_items',
  'fk_work_item_feature',
  'FOREIGN KEY (`feature_id`) REFERENCES `product_version_features` (`id`) ON DELETE SET NULL'
);

DROP PROCEDURE IF EXISTS `hzy_add_column_if_missing`;
DROP PROCEDURE IF EXISTS `hzy_add_index_if_missing`;
DROP PROCEDURE IF EXISTS `hzy_add_fk_if_missing`;
