-- v4.5 项目-正式环境执行关系
-- Aims 只保存项目执行关系和历史快照；正式环境主档、客户归属和长期当前态以 Assets 为准。

CREATE TABLE IF NOT EXISTS `project_environments` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `project_id` BIGINT UNSIGNED NOT NULL COMMENT 'Aims项目ID',
  `environment_code` VARCHAR(64) NOT NULL COMMENT 'Assets正式环境编码',
  `delivery_asset_code` VARCHAR(64) DEFAULT NULL COMMENT 'Assets正式客户交付资产编码',
  `relation_type` ENUM('initial_delivery','upgrade','migration','maintenance','decommission','verification','other') NOT NULL DEFAULT 'initial_delivery',
  `delivery_status` ENUM('planned','provisioning','deployed','online','accepted','handed_over','suspended','cancelled') NOT NULL DEFAULT 'planned',
  `is_primary` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否本项目主环境',
  `planned_go_live_at` DATETIME DEFAULT NULL COMMENT '计划上线时间',
  `actual_go_live_at` DATETIME DEFAULT NULL COMMENT '实际上线时间',
  `accepted_at` DATETIME DEFAULT NULL COMMENT '验收时间',
  `handover_status` ENUM('pending','ready','completed','rejected') NOT NULL DEFAULT 'pending',
  `handover_at` DATETIME DEFAULT NULL COMMENT '交接时间',
  `delivery_version_snapshot` VARCHAR(100) DEFAULT NULL COMMENT '本次项目交付版本快照',
  `assets_sync_status` ENUM('pending','synced','failed') NOT NULL DEFAULT 'pending',
  `assets_sync_error` TEXT DEFAULT NULL COMMENT 'Assets同步失败详情',
  `assets_synced_at` DATETIME DEFAULT NULL COMMENT 'Assets同步成功时间',
  `source_contract_line_code` VARCHAR(64) DEFAULT NULL COMMENT '来源合同行编码',
  `source_obligation_code` VARCHAR(64) DEFAULT NULL COMMENT '来源履约义务编码',
  `created_by` VARCHAR(64) DEFAULT NULL,
  `updated_by` VARCHAR(64) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` DATETIME DEFAULT NULL,
  `active_relation_key` VARCHAR(255) DEFAULT NULL COMMENT '当前有效关系唯一键，由 runtime 在写入和恢复时维护，软删除时清空',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_project_environment_active_relation` (`active_relation_key`),
  KEY `idx_project_environment_project` (`project_id`, `delivery_status`),
  KEY `idx_project_environment_environment` (`environment_code`, `delivery_status`),
  KEY `idx_project_environment_delivery_asset` (`delivery_asset_code`, `delivery_status`),
  KEY `idx_project_environment_sync` (`assets_sync_status`, `updated_at`),
  CONSTRAINT `fk_project_environment_project` FOREIGN KEY (`project_id`) REFERENCES `aims_projects` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='项目-正式环境执行关系';

SELECT
  (SELECT COUNT(*) FROM `project_environments` WHERE deleted_at IS NULL) AS project_environment_count,
  (SELECT COUNT(DISTINCT environment_code) FROM `project_environments` WHERE deleted_at IS NULL) AS distinct_environment_count,
  (SELECT COUNT(*)
   FROM `project_environments`
   WHERE deleted_at IS NULL
     AND (environment_code IS NULL OR environment_code = '')) AS missing_environment_code_count,
  (SELECT COUNT(*)
   FROM (
     SELECT project_id, environment_code, COALESCE(delivery_asset_code, '') AS delivery_asset_code, relation_type
     FROM `project_environments`
     WHERE deleted_at IS NULL
     GROUP BY project_id, environment_code, COALESCE(delivery_asset_code, ''), relation_type
     HAVING COUNT(*) > 1
   ) duplicate_relation) AS duplicate_active_relation_count,
  (SELECT COUNT(*) FROM `project_environments` WHERE assets_sync_status = 'failed' AND deleted_at IS NULL) AS failed_assets_sync_count;
