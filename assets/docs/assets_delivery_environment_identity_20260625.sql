-- Assets incremental schema for formal delivery asset / environment identity.
-- Run in hzy_assets or the target Assets tenant database after
-- assets_customer_delivery_assets_20260622.sql.
--
-- customer_delivery_assets.environment_code remains as the primary environment
-- snapshot for compatibility. The complete deployment truth is
-- customer_delivery_asset_environment_rel.

DELIMITER $$

DROP PROCEDURE IF EXISTS `assets_goal2_add_column`$$
CREATE PROCEDURE `assets_goal2_add_column`(
  IN p_table_name VARCHAR(64),
  IN p_column_name VARCHAR(64),
  IN p_column_definition TEXT
)
BEGIN
  SET @column_exists := (
    SELECT COUNT(*)
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = p_table_name
      AND COLUMN_NAME = p_column_name
  );

  IF @column_exists = 0 THEN
    SET @sql := CONCAT('ALTER TABLE `', p_table_name, '` ADD COLUMN ', p_column_definition);
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END$$

DROP PROCEDURE IF EXISTS `assets_goal2_modify_environment_project_nullable`$$
CREATE PROCEDURE `assets_goal2_modify_environment_project_nullable`()
BEGIN
  SET @is_nullable := (
    SELECT IS_NULLABLE
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'asset_environments'
      AND COLUMN_NAME = 'project_code'
    LIMIT 1
  );

  IF @is_nullable = 'NO' THEN
    ALTER TABLE `asset_environments`
      MODIFY COLUMN `project_code` VARCHAR(191) DEFAULT NULL COMMENT '初始/来源项目快照，项目历史以 Aims project_environments 为准';
  END IF;
END$$

DELIMITER ;

CALL `assets_goal2_modify_environment_project_nullable`();
CALL `assets_goal2_add_column`('asset_environments', 'deployment_mode', '`deployment_mode` VARCHAR(50) DEFAULT NULL COMMENT ''部署模式快照'' AFTER `status`');
CALL `assets_goal2_add_column`('asset_environments', 'region', '`region` VARCHAR(100) DEFAULT NULL COMMENT ''部署区域快照'' AFTER `deployment_mode`');
CALL `assets_goal2_add_column`('asset_environments', 'idempotency_key', '`idempotency_key` VARCHAR(240) DEFAULT NULL COMMENT ''服务创建幂等键'' AFTER `region`');
CALL `assets_goal2_add_column`('asset_environments', 'go_live_at', '`go_live_at` DATETIME DEFAULT NULL COMMENT ''上线时间'' AFTER `idempotency_key`');
CALL `assets_goal2_add_column`('asset_environments', 'accepted_at', '`accepted_at` DATETIME DEFAULT NULL COMMENT ''验收时间'' AFTER `go_live_at`');
CALL `assets_goal2_add_column`('asset_environments', 'retired_at', '`retired_at` DATETIME DEFAULT NULL COMMENT ''退役时间'' AFTER `accepted_at`');

SET @assets_goal2_idx_exists := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'asset_environments'
    AND INDEX_NAME = 'uk_environment_idempotency'
);
SET @assets_goal2_idx_sql := IF(
  @assets_goal2_idx_exists = 0,
  'ALTER TABLE `asset_environments` ADD UNIQUE KEY `uk_environment_idempotency` (`idempotency_key`)',
  'SELECT 1'
);
PREPARE stmt FROM @assets_goal2_idx_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @assets_goal2_customer_idx_exists := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'asset_environments'
    AND INDEX_NAME = 'idx_environment_customer'
);
SET @assets_goal2_customer_idx_sql := IF(
  @assets_goal2_customer_idx_exists = 0,
  'ALTER TABLE `asset_environments` ADD KEY `idx_environment_customer` (`customer_code`, `status`)',
  'SELECT 1'
);
PREPARE stmt FROM @assets_goal2_customer_idx_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @assets_goal2_source_plan_idx_exists := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'customer_delivery_assets'
    AND INDEX_NAME = 'idx_customer_delivery_asset_source_plan'
);
SET @assets_goal2_source_plan_idx_sql := IF(
  @assets_goal2_source_plan_idx_exists = 0,
  'ALTER TABLE `customer_delivery_assets` ADD KEY `idx_customer_delivery_asset_source_plan` (`source_plan_code`)',
  'SELECT 1'
);
PREPARE stmt FROM @assets_goal2_source_plan_idx_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS `customer_delivery_asset_environment_rel` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `delivery_asset_id` BIGINT UNSIGNED NOT NULL COMMENT '客户交付资产ID',
  `environment_id` BIGINT UNSIGNED NOT NULL COMMENT '正式环境ID',
  `relation_type` ENUM('primary','test','production','backup','disaster_recovery','training','other') NOT NULL DEFAULT 'primary',
  `is_primary` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否当前主环境',
  `deployment_status` ENUM('planned','provisioning','deployed','online','accepted','suspended','removed') NOT NULL DEFAULT 'planned',
  `deployed_version` VARCHAR(100) DEFAULT NULL COMMENT '该交付资产在此环境中的当前部署版本',
  `effective_from` DATETIME DEFAULT NULL COMMENT '生效时间',
  `effective_to` DATETIME DEFAULT NULL COMMENT '结束时间',
  `status` ENUM('active','ended','cancelled') NOT NULL DEFAULT 'active',
  `source_project_code` VARCHAR(191) DEFAULT NULL COMMENT '来源 Aims 项目编码',
  `created_by` VARCHAR(64) DEFAULT NULL,
  `updated_by` VARCHAR(64) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` DATETIME DEFAULT NULL,
  `active_relation_key` VARCHAR(255) GENERATED ALWAYS AS (
    CASE WHEN `deleted_at` IS NULL THEN CONCAT(`delivery_asset_id`, ':', `environment_id`, ':', `relation_type`) ELSE NULL END
  ) STORED,
  `active_primary_key` VARCHAR(191) GENERATED ALWAYS AS (
    CASE WHEN `deleted_at` IS NULL AND `status` = 'active' AND `is_primary` = 1 THEN CAST(`delivery_asset_id` AS CHAR) ELSE NULL END
  ) STORED,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_cdaer_active_relation` (`active_relation_key`),
  UNIQUE KEY `uk_cdaer_active_primary` (`active_primary_key`),
  KEY `idx_cdaer_delivery_asset` (`delivery_asset_id`, `status`),
  KEY `idx_cdaer_environment` (`environment_id`, `status`),
  KEY `idx_cdaer_source_project` (`source_project_code`, `status`),
  KEY `idx_cdaer_status` (`deployment_status`, `status`),
  CONSTRAINT `fk_cdaer_delivery_asset` FOREIGN KEY (`delivery_asset_id`) REFERENCES `customer_delivery_assets` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_cdaer_environment` FOREIGN KEY (`environment_id`) REFERENCES `asset_environments` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='客户交付资产与正式环境部署关系';

INSERT INTO `customer_delivery_asset_environment_rel` (
  `delivery_asset_id`,
  `environment_id`,
  `relation_type`,
  `is_primary`,
  `deployment_status`,
  `deployed_version`,
  `effective_from`,
  `status`,
  `source_project_code`,
  `created_by`,
  `updated_by`
)
SELECT
  cda.id,
  env.id,
  'primary',
  1,
  CASE
    WHEN cda.status IN ('online', 'accepted') THEN cda.status
    WHEN cda.status = 'delivered' THEN 'deployed'
    WHEN cda.status = 'provisioning' THEN 'provisioning'
    ELSE 'planned'
  END,
  cda.product_version,
  COALESCE(cda.go_live_at, cda.delivered_at, cda.created_at),
  'active',
  cda.project_code,
  'migration_goal2_assets',
  'migration_goal2_assets'
FROM `customer_delivery_assets` cda
INNER JOIN `asset_environments` env
  ON env.environment_code = cda.environment_code
WHERE cda.deleted_at IS NULL
  AND cda.environment_code IS NOT NULL
  AND cda.environment_code <> ''
  AND (
    cda.customer_code IS NULL
    OR cda.customer_code = ''
    OR env.customer_code IS NULL
    OR env.customer_code = ''
    OR cda.customer_code = env.customer_code
  )
  AND NOT EXISTS (
    SELECT 1
    FROM `customer_delivery_asset_environment_rel` rel
    WHERE rel.delivery_asset_id = cda.id
      AND rel.environment_id = env.id
      AND rel.relation_type = 'primary'
      AND rel.deleted_at IS NULL
  );

DROP PROCEDURE IF EXISTS `assets_goal2_add_column`;
DROP PROCEDURE IF EXISTS `assets_goal2_modify_environment_project_nullable`;

SELECT
  (SELECT COUNT(*) FROM `customer_delivery_assets` WHERE deleted_at IS NULL AND environment_code IS NOT NULL AND environment_code <> '') AS legacy_environment_snapshot_count,
  (SELECT COUNT(*) FROM `customer_delivery_asset_environment_rel` WHERE deleted_at IS NULL) AS relation_count,
  (SELECT COUNT(*)
   FROM `customer_delivery_assets` cda
   WHERE cda.deleted_at IS NULL
     AND cda.environment_code IS NOT NULL
     AND cda.environment_code <> ''
     AND NOT EXISTS (
       SELECT 1
       FROM `customer_delivery_asset_environment_rel` rel
       INNER JOIN `asset_environments` env ON env.id = rel.environment_id
       WHERE rel.delivery_asset_id = cda.id
         AND env.environment_code = cda.environment_code
         AND rel.deleted_at IS NULL
     )) AS legacy_snapshot_missing_relation_count,
  (SELECT COUNT(*)
   FROM (
     SELECT delivery_asset_id
     FROM `customer_delivery_asset_environment_rel`
     WHERE deleted_at IS NULL
       AND status = 'active'
       AND is_primary = 1
     GROUP BY delivery_asset_id
     HAVING COUNT(*) > 1
   ) duplicate_primary) AS multiple_primary_delivery_asset_count,
  (SELECT COUNT(*)
   FROM `customer_delivery_asset_environment_rel` rel
   INNER JOIN `customer_delivery_assets` cda ON cda.id = rel.delivery_asset_id
   INNER JOIN `asset_environments` env ON env.id = rel.environment_id
   WHERE rel.deleted_at IS NULL
     AND cda.customer_code IS NOT NULL
     AND cda.customer_code <> ''
     AND env.customer_code IS NOT NULL
     AND env.customer_code <> ''
     AND cda.customer_code <> env.customer_code) AS cross_customer_relation_count,
  (SELECT COUNT(*)
   FROM `customer_delivery_asset_environment_rel` rel
   LEFT JOIN `customer_delivery_assets` cda ON cda.id = rel.delivery_asset_id
   LEFT JOIN `asset_environments` env ON env.id = rel.environment_id
   WHERE rel.deleted_at IS NULL
     AND (cda.id IS NULL OR env.id IS NULL)) AS orphan_environment_relation_count,
  (SELECT COUNT(*) FROM `customer_delivery_asset_environment_rel` WHERE deleted_at IS NULL AND is_primary = 1 AND status = 'active') AS active_primary_relation_count;
