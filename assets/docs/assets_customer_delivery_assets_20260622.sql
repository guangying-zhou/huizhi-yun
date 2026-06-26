-- Assets incremental schema for Altoc P1 customer delivery assets.
-- Run in hzy_assets or the target Assets tenant database.
--
-- This table is the Assets-side customer delivery asset master. It allows
-- project_code to be NULL so software license / SaaS contracts that do not
-- require Aims projects can still form traceable customer assets.

CREATE TABLE IF NOT EXISTS `customer_delivery_assets` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `delivery_asset_code` VARCHAR(64) NOT NULL COMMENT '客户交付资产编码',
  `customer_code` VARCHAR(100) NOT NULL COMMENT '客户编码(关联Altoc customer.code)',
  `contract_code` VARCHAR(100) DEFAULT NULL COMMENT '合同编号(关联Altoc contract.code)',
  `contract_line_code` VARCHAR(64) DEFAULT NULL COMMENT '合同行编码',
  `obligation_code` VARCHAR(64) DEFAULT NULL COMMENT '履约义务编码',
  `project_code` VARCHAR(191) DEFAULT NULL COMMENT 'Aims项目编码，许可销售可为空',
  `delivery_view_code` VARCHAR(64) DEFAULT NULL COMMENT '交付视图编码',
  `asset_item_code` VARCHAR(64) DEFAULT NULL COMMENT '正式资产编码',
  `product_code` VARCHAR(100) DEFAULT NULL COMMENT '产品编码',
  `product_name` VARCHAR(255) NOT NULL COMMENT '产品或资产名称',
  `product_version` VARCHAR(100) DEFAULT NULL COMMENT '产品版本',
  `catalog_item_code` VARCHAR(100) DEFAULT NULL COMMENT '目录项编码',
  `product_origin` VARCHAR(30) DEFAULT NULL COMMENT '产品来源',
  `asset_kind` VARCHAR(50) NOT NULL DEFAULT 'software' COMMENT '交付资产类型',
  `deployment_mode` VARCHAR(50) DEFAULT NULL COMMENT '部署模式',
  `instance_key` VARCHAR(100) DEFAULT NULL COMMENT '实例键',
  `tenant_key` VARCHAR(100) DEFAULT NULL COMMENT '租户键',
  `environment_code` VARCHAR(100) DEFAULT NULL COMMENT '环境编码',
  `license_model` VARCHAR(50) DEFAULT NULL COMMENT '授权模型',
  `license_quantity` DECIMAL(18,4) DEFAULT NULL COMMENT '授权数量',
  `capacity` DECIMAL(18,4) DEFAULT NULL COMMENT '容量',
  `unit` VARCHAR(30) DEFAULT NULL COMMENT '单位',
  `status` ENUM('planned','provisioning','delivered','online','accepted','suspended','expired','terminated') NOT NULL DEFAULT 'planned' COMMENT '生命周期状态',
  `planned_delivery_at` DATETIME DEFAULT NULL COMMENT '计划交付时间',
  `delivered_at` DATETIME DEFAULT NULL COMMENT '交付时间',
  `go_live_at` DATETIME DEFAULT NULL COMMENT '上线时间',
  `accepted_at` DATETIME DEFAULT NULL COMMENT '验收时间',
  `expired_at` DATETIME DEFAULT NULL COMMENT '到期时间',
  `terminated_at` DATETIME DEFAULT NULL COMMENT '终止时间',
  `warranty_start_at` DATETIME DEFAULT NULL COMMENT '质保开始时间',
  `warranty_end_at` DATETIME DEFAULT NULL COMMENT '质保结束时间',
  `support_expiry_at` DATETIME DEFAULT NULL COMMENT '支持到期时间',
  `source_app` VARCHAR(50) NOT NULL DEFAULT 'altoc' COMMENT '来源应用',
  `source_biz_code` VARCHAR(100) DEFAULT NULL COMMENT '来源业务编码',
  `source_plan_code` VARCHAR(100) DEFAULT NULL COMMENT '来源计划编码',
  `idempotency_key` VARCHAR(240) DEFAULT NULL COMMENT '幂等键',
  `created_by` VARCHAR(64) DEFAULT NULL,
  `updated_by` VARCHAR(64) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` DATETIME DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_customer_delivery_asset_code` (`delivery_asset_code`),
  UNIQUE KEY `uk_customer_delivery_asset_line` (`contract_code`, `contract_line_code`, `instance_key`),
  KEY `idx_customer_delivery_asset_customer` (`customer_code`, `status`),
  KEY `idx_customer_delivery_asset_contract` (`contract_code`, `status`),
  KEY `idx_customer_delivery_asset_project` (`project_code`, `status`),
  KEY `idx_customer_delivery_asset_product` (`product_code`),
  KEY `idx_customer_delivery_asset_asset_item` (`asset_item_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='客户交付资产主档';

SET @hzy_asset_event_object_type = (
  SELECT COLUMN_TYPE
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'asset_events'
    AND COLUMN_NAME = 'object_type'
);

SET @hzy_asset_event_has_customer_delivery_asset =
  IF(@hzy_asset_event_object_type LIKE '%customer_delivery_asset%', 1, 0);

SET @hzy_asset_event_alter_sql = IF(
  @hzy_asset_event_has_customer_delivery_asset = 0,
  'ALTER TABLE asset_events MODIFY COLUMN object_type ENUM(''asset'', ''environment'', ''delivery_view'', ''customer_delivery_asset'', ''purchase_order'', ''assignment'', ''alert'', ''supplier'', ''product_asset'', ''technology_base'', ''ip_asset'', ''digital_asset'') NOT NULL',
  'SELECT 1'
);

PREPARE stmt FROM @hzy_asset_event_alter_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
