-- v5.18 product tables copied before the product-center expansion.
-- Fixture intentionally retains the legacy column set for migration regression.

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
