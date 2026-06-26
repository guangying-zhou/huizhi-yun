-- ============================================
-- Assets MVP - 统一数据库结构
-- 数据库名: hzy_assets
-- 执行说明:
-- 1. 删除并重建数据库后，先执行本文件
-- 2. 再执行 assets_seed.sql 初始化联调数据
-- 3. 本文件已包含当前代码依赖的 asset_purpose、三类采购目的与资产操作结构
-- 4. 项目主数据来自 Account，Assets 只保存 project_code 引用
-- 5. 客户与合同主数据来自 Altoc，Assets 只保存 customer_code / contract_code
-- 6. 文档正文来自 Codocs，Assets 只保存 document_id 引用
-- 7. 审批实例来自 Workflow，Assets 保存 workflow_instance_id 并回写业务终态
-- ============================================
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- 创建数据库
CREATE DATABASE IF NOT EXISTS `hzy_assets` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `hzy_assets`;

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `system_parameters` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `param_key` VARCHAR(100) NOT NULL,
  `param_value` TEXT NOT NULL,
  `description` VARCHAR(255) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_param_key` (`param_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='系统参数';

CREATE TABLE IF NOT EXISTS `asset_category_groups` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `category_scope` VARCHAR(32) NOT NULL COMMENT '分类作用域：physical/resource/product/ip/digital',
  `category_value` VARCHAR(64) NOT NULL COMMENT '子类存储值',
  `category_label` VARCHAR(100) NOT NULL COMMENT '子类显示名',
  `short_code` VARCHAR(16) DEFAULT NULL COMMENT '用于设备编码生成的缩写码',
  `description` VARCHAR(255) DEFAULT NULL,
  `enabled` TINYINT(1) NOT NULL DEFAULT 1,
  `sort_order` INT NOT NULL DEFAULT 0,
  `created_by` VARCHAR(64) DEFAULT NULL,
  `updated_by` VARCHAR(64) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_asset_category_scope_value` (`category_scope`, `category_value`),
  KEY `idx_asset_category_scope_order` (`category_scope`, `sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='资产类别分组定义';

CREATE TABLE IF NOT EXISTS `asset_category_items` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `group_id` BIGINT UNSIGNED NOT NULL,
  `item_value` VARCHAR(64) NOT NULL COMMENT '细类存储值',
  `item_label` VARCHAR(100) NOT NULL COMMENT '细类显示名',
  `short_code` VARCHAR(16) DEFAULT NULL COMMENT '用于设备编码生成的缩写码',
  `description` VARCHAR(255) DEFAULT NULL,
  `enabled` TINYINT(1) NOT NULL DEFAULT 1,
  `sort_order` INT NOT NULL DEFAULT 0,
  `created_by` VARCHAR(64) DEFAULT NULL,
  `updated_by` VARCHAR(64) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_asset_category_item` (`group_id`, `item_value`),
  KEY `idx_asset_category_item_order` (`group_id`, `sort_order`),
  CONSTRAINT `fk_asset_category_item_group` FOREIGN KEY (`group_id`) REFERENCES `asset_category_groups` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='资产类别细项定义';

CREATE TABLE IF NOT EXISTS `asset_items` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `public_id` VARCHAR(36) DEFAULT NULL COMMENT '对外公开标识，用于详情路由和二维码',
  `asset_code` VARCHAR(64) NOT NULL COMMENT '资产编号',
  `asset_name` VARCHAR(255) NOT NULL COMMENT '资产名称',
  `asset_category` ENUM('physical', 'resource', 'product', 'ip', 'digital') NOT NULL DEFAULT 'physical',
  `asset_subtype` VARCHAR(64) NOT NULL COMMENT '资产子类',
  `asset_purpose` VARCHAR(64) NOT NULL DEFAULT 'self_use' COMMENT '资产归因目的：self_use/project_procurement/sales_stock',
  `ownership_type` ENUM('internal', 'customer_delivery') NOT NULL DEFAULT 'internal',
  `dept_code` VARCHAR(64) NOT NULL COMMENT '归属部门',
  `project_code` VARCHAR(191) DEFAULT NULL COMMENT '关联 Account.project_code',
  `customer_code` VARCHAR(64) DEFAULT NULL COMMENT '关联 Altoc.customer_code',
  `contract_code` VARCHAR(64) DEFAULT NULL COMMENT '关联 Altoc.contract_code',
  `environment_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '主要关联环境',
  `owner_uid` VARCHAR(64) DEFAULT NULL COMMENT '负责人',
  `user_uid` VARCHAR(64) DEFAULT NULL COMMENT '使用人',
  `custodian_uid` VARCHAR(64) DEFAULT NULL COMMENT '保管人',
  `status` VARCHAR(64) NOT NULL COMMENT '统一状态字段',
  `source_type` ENUM('purchase_order', 'manual', 'import', 'sync') NOT NULL DEFAULT 'manual',
  `source_no` VARCHAR(64) DEFAULT NULL COMMENT '来源单号',
  `cost_bearer` ENUM('company', 'customer', 'shared') NOT NULL DEFAULT 'company',
  `finance_subject` VARCHAR(100) DEFAULT NULL,
  `sensitivity_level` ENUM('normal', 'important', 'sensitive', 'critical') NOT NULL DEFAULT 'normal',
  `is_external_exposed` TINYINT(1) NOT NULL DEFAULT 0,
  `is_key_business_asset` TINYINT(1) NOT NULL DEFAULT 0,
  `tags` JSON DEFAULT NULL,
  `notes` TEXT DEFAULT NULL,
  `created_by` VARCHAR(64) DEFAULT NULL,
  `updated_by` VARCHAR(64) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `archived_at` DATETIME DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_asset_public_id` (`public_id`),
  UNIQUE KEY `uk_asset_code` (`asset_code`),
  KEY `idx_asset_category_status` (`asset_category`, `status`),
  KEY `idx_asset_project_code` (`project_code`),
  KEY `idx_asset_dept_code` (`dept_code`),
  KEY `idx_asset_owner_uid` (`owner_uid`),
  KEY `idx_asset_user_uid` (`user_uid`),
  KEY `idx_asset_contract_code` (`contract_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='统一资产主表';

CREATE TABLE IF NOT EXISTS `asset_physical_details` (
  `asset_id` BIGINT UNSIGNED NOT NULL,
  `physical_type` VARCHAR(64) NOT NULL COMMENT '实物二级细类，如笔记本/办公桌/服务器/NAS/公务车/样机/鼠标',
  `brand` VARCHAR(100) DEFAULT NULL,
  `model` VARCHAR(100) DEFAULT NULL,
  `config_detail` TEXT DEFAULT NULL COMMENT '详细配置，如 CPU/内存/磁盘/尺寸/配件说明',
  `serial_number` VARCHAR(128) DEFAULT NULL,
  `location` VARCHAR(255) DEFAULT NULL,
  `purchased_at` DATE DEFAULT NULL,
  `purchase_amount` DECIMAL(12,2) DEFAULT NULL,
  `expected_service_years` SMALLINT UNSIGNED DEFAULT NULL,
  `inventory_status` ENUM('pending_stock_in', 'in_stock', 'in_use', 'idle', 'repairing', 'scrapped') NOT NULL DEFAULT 'pending_stock_in',
  `claim_status` ENUM('unclaimed', 'claimed', 'returned') NOT NULL DEFAULT 'unclaimed',
  `qr_code` VARCHAR(255) DEFAULT NULL,
  PRIMARY KEY (`asset_id`),
  UNIQUE KEY `uk_serial_number` (`serial_number`),
  CONSTRAINT `fk_physical_asset` FOREIGN KEY (`asset_id`) REFERENCES `asset_items` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='实物资产扩展字段';

CREATE TABLE IF NOT EXISTS `asset_resource_details` (
  `asset_id` BIGINT UNSIGNED NOT NULL,
  `resource_type` ENUM('infrastructure', 'platform', 'subscription', 'quota_api', 'ai', 'security_access') NOT NULL,
  `provider` VARCHAR(100) DEFAULT NULL COMMENT '服务商/来源',
  `instance_identifier` VARCHAR(191) DEFAULT NULL COMMENT '实例 ID、账号、套餐编号等',
  `spec_summary` VARCHAR(255) DEFAULT NULL COMMENT '规格摘要',
  `deployment_mode` ENUM('public_cloud', 'private', 'on_premise', 'hybrid') NOT NULL DEFAULT 'public_cloud',
  `billing_mode` ENUM('annual', 'usage', 'subscription', 'one_time') NOT NULL DEFAULT 'subscription',
  `billing_cycle` ENUM('monthly', 'yearly', 'realtime', 'one_time') NOT NULL DEFAULT 'monthly',
  `effective_at` DATE DEFAULT NULL,
  `expires_at` DATE DEFAULT NULL,
  `auto_renew` TINYINT(1) NOT NULL DEFAULT 0,
  `monthly_cost` DECIMAL(12,2) DEFAULT NULL,
  `usage_mode` ENUM('resource', 'seat', 'key', 'token', 'quota') NOT NULL DEFAULT 'resource',
  `purchased_quantity` DECIMAL(12,2) DEFAULT NULL,
  `assigned_quantity` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `available_quantity` DECIMAL(12,2) DEFAULT NULL,
  `tenant_account` VARCHAR(191) DEFAULT NULL,
  `credential_ciphertext` TEXT DEFAULT NULL COMMENT '加密后的敏感凭证',
  `credential_masked` VARCHAR(255) DEFAULT NULL COMMENT '脱敏后显示值',
  `credential_updated_at` DATETIME DEFAULT NULL,
  `last_synced_at` DATETIME DEFAULT NULL,
  PRIMARY KEY (`asset_id`),
  KEY `idx_resource_type_expire` (`resource_type`, `expires_at`),
  KEY `idx_resource_provider` (`provider`),
  CONSTRAINT `fk_resource_asset` FOREIGN KEY (`asset_id`) REFERENCES `asset_items` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='资源资产扩展字段';

CREATE TABLE IF NOT EXISTS `asset_environments` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `environment_code` VARCHAR(64) NOT NULL,
  `environment_name` VARCHAR(255) NOT NULL,
  `environment_type` ENUM('dev', 'test', 'staging', 'internal_prod', 'customer_test', 'customer_prod') NOT NULL,
  `project_code` VARCHAR(191) DEFAULT NULL COMMENT '初始/来源项目快照，项目历史以 Aims project_environments 为准',
  `customer_code` VARCHAR(64) DEFAULT NULL,
  `contract_code` VARCHAR(64) DEFAULT NULL,
  `status` ENUM('planning', 'active', 'frozen', 'retired') NOT NULL DEFAULT 'planning',
  `deployment_mode` VARCHAR(50) DEFAULT NULL COMMENT '部署模式快照',
  `region` VARCHAR(100) DEFAULT NULL COMMENT '部署区域快照',
  `idempotency_key` VARCHAR(240) DEFAULT NULL COMMENT '服务创建幂等键',
  `go_live_at` DATETIME DEFAULT NULL COMMENT '上线时间',
  `accepted_at` DATETIME DEFAULT NULL COMMENT '验收时间',
  `retired_at` DATETIME DEFAULT NULL COMMENT '退役时间',
  `dept_code` VARCHAR(64) DEFAULT NULL,
  `owner_uid` VARCHAR(64) DEFAULT NULL,
  `maintainer_uid` VARCHAR(64) DEFAULT NULL,
  `topology_summary` TEXT DEFAULT NULL,
  `notes` TEXT DEFAULT NULL,
  `created_by` VARCHAR(64) DEFAULT NULL,
  `updated_by` VARCHAR(64) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_environment_code` (`environment_code`),
  UNIQUE KEY `uk_environment_idempotency` (`idempotency_key`),
  KEY `idx_environment_project_status` (`project_code`, `status`),
  KEY `idx_environment_contract` (`contract_code`),
  KEY `idx_environment_customer` (`customer_code`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='环境视图';

CREATE TABLE IF NOT EXISTS `asset_environment_assets` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `environment_id` BIGINT UNSIGNED NOT NULL,
  `asset_id` BIGINT UNSIGNED NOT NULL,
  `relation_type` ENUM('compute', 'database', 'middleware', 'seat', 'quota', 'domain_cert', 'security', 'delivery_artifact', 'other') NOT NULL DEFAULT 'other',
  `is_primary` TINYINT(1) NOT NULL DEFAULT 0,
  `created_by` VARCHAR(64) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_environment_asset` (`environment_id`, `asset_id`, `relation_type`),
  KEY `idx_environment_asset_asset` (`asset_id`),
  CONSTRAINT `fk_environment_assets_environment` FOREIGN KEY (`environment_id`) REFERENCES `asset_environments` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_environment_assets_asset` FOREIGN KEY (`asset_id`) REFERENCES `asset_items` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='环境与资产关联';

CREATE TABLE IF NOT EXISTS `asset_delivery_views` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `delivery_code` VARCHAR(64) NOT NULL,
  `delivery_name` VARCHAR(255) NOT NULL,
  `customer_code` VARCHAR(64) NOT NULL,
  `contract_code` VARCHAR(64) DEFAULT NULL,
  `project_code` VARCHAR(191) NOT NULL,
  `status` ENUM('preparing', 'delivering', 'online', 'accepted', 'terminated') NOT NULL DEFAULT 'preparing',
  `owner_uid` VARCHAR(64) DEFAULT NULL,
  `go_live_at` DATE DEFAULT NULL,
  `accepted_at` DATE DEFAULT NULL,
  `notes` TEXT DEFAULT NULL,
  `created_by` VARCHAR(64) DEFAULT NULL,
  `updated_by` VARCHAR(64) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_delivery_code` (`delivery_code`),
  KEY `idx_delivery_project_status` (`project_code`, `status`),
  KEY `idx_delivery_contract` (`contract_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='客户交付视图';

CREATE TABLE IF NOT EXISTS `asset_delivery_environments` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `delivery_view_id` BIGINT UNSIGNED NOT NULL,
  `environment_id` BIGINT UNSIGNED NOT NULL,
  `relation_type` ENUM('primary', 'backup', 'test', 'training', 'other') NOT NULL DEFAULT 'primary',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_delivery_environment` (`delivery_view_id`, `environment_id`, `relation_type`),
  CONSTRAINT `fk_delivery_environments_delivery` FOREIGN KEY (`delivery_view_id`) REFERENCES `asset_delivery_views` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_delivery_environments_environment` FOREIGN KEY (`environment_id`) REFERENCES `asset_environments` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='交付视图与环境关联';

CREATE TABLE IF NOT EXISTS `asset_delivery_products` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `delivery_view_id` BIGINT UNSIGNED NOT NULL,
  `product_asset_id` BIGINT UNSIGNED NOT NULL,
  `relation_type` VARCHAR(64) NOT NULL DEFAULT 'delivered_product',
  `created_by` VARCHAR(64) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_delivery_product` (`delivery_view_id`, `product_asset_id`, `relation_type`),
  KEY `idx_delivery_product_product` (`product_asset_id`),
  CONSTRAINT `fk_delivery_products_delivery` FOREIGN KEY (`delivery_view_id`) REFERENCES `asset_delivery_views` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_delivery_products_product` FOREIGN KEY (`product_asset_id`) REFERENCES `product_assets` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='交付视图与产品资产关联';

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
  KEY `idx_customer_delivery_asset_source_plan` (`source_plan_code`),
  KEY `idx_customer_delivery_asset_product` (`product_code`),
  KEY `idx_customer_delivery_asset_asset_item` (`asset_item_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='客户交付资产主档';

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

CREATE TABLE IF NOT EXISTS `asset_documents` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `object_type` ENUM('asset', 'environment', 'delivery_view', 'purchase_order', 'product_asset', 'technology_base', 'ip_asset', 'digital_asset') NOT NULL,
  `object_id` BIGINT UNSIGNED NOT NULL,
  `document_id` VARCHAR(64) NOT NULL COMMENT '关联 Codocs document_id',
  `document_type` ENUM('requirement', 'design', 'api', 'ops', 'delivery', 'attachment', 'other') NOT NULL DEFAULT 'other',
  `artifact_type` ENUM('solution', 'requirement', 'design', 'test_report', 'deployment_manual', 'acceptance_report', 'training_material', 'ops_knowledge', 'customer_environment_record') DEFAULT NULL COMMENT '交付成果类型：方案/需求/设计/测试报告/部署手册/验收报告/培训材料/运维知识/客户环境记录',
  `source_context` JSON DEFAULT NULL COMMENT '来源上下文：source_app/source_biz/project/milestone/customer/contract/delivery',
  `remark` VARCHAR(255) DEFAULT NULL,
  `linked_by` VARCHAR(64) DEFAULT NULL,
  `linked_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_object_document` (`object_type`, `object_id`, `document_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='关联文档';

CREATE TABLE IF NOT EXISTS `product_assets` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `product_code` VARCHAR(64) NOT NULL,
  `product_name` VARCHAR(255) NOT NULL,
  `product_line` VARCHAR(64) NOT NULL,
  `customer_domain` VARCHAR(64) NOT NULL,
  `business_domain` VARCHAR(64) NOT NULL,
  `product_level` VARCHAR(64) DEFAULT NULL,
  `asset_level` VARCHAR(16) DEFAULT NULL,
  `status` VARCHAR(64) NOT NULL DEFAULT 'iterating',
  `summary` TEXT DEFAULT NULL,
  `built_at` DATE DEFAULT NULL,
  `business_owner_uid` VARCHAR(64) DEFAULT NULL,
  `technical_owner_uid` VARCHAR(64) DEFAULT NULL,
  `project_code` VARCHAR(191) DEFAULT NULL,
  `notes` TEXT DEFAULT NULL,
  `created_by` VARCHAR(64) DEFAULT NULL,
  `updated_by` VARCHAR(64) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_product_code` (`product_code`),
  KEY `idx_product_line_status` (`product_line`, `status`),
  KEY `idx_product_project_code` (`project_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='产品资产主档';

CREATE TABLE IF NOT EXISTS `technology_bases` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `base_code` VARCHAR(64) NOT NULL,
  `base_name` VARCHAR(255) NOT NULL,
  `base_type` VARCHAR(64) NOT NULL,
  `status` VARCHAR(64) NOT NULL DEFAULT 'active',
  `service_targets` TEXT DEFAULT NULL,
  `owner_uid` VARCHAR(64) DEFAULT NULL,
  `technical_owner_uid` VARCHAR(64) DEFAULT NULL,
  `project_code` VARCHAR(191) DEFAULT NULL,
  `asset_level` VARCHAR(16) DEFAULT NULL,
  `notes` TEXT DEFAULT NULL,
  `created_by` VARCHAR(64) DEFAULT NULL,
  `updated_by` VARCHAR(64) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_base_code` (`base_code`),
  KEY `idx_base_type_status` (`base_type`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='技术底座主档';

CREATE TABLE IF NOT EXISTS `product_asset_bases` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `product_asset_id` BIGINT UNSIGNED NOT NULL,
  `technology_base_id` BIGINT UNSIGNED NOT NULL,
  `created_by` VARCHAR(64) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_product_base` (`product_asset_id`, `technology_base_id`),
  KEY `idx_product_base_base` (`technology_base_id`),
  CONSTRAINT `fk_product_asset_bases_product` FOREIGN KEY (`product_asset_id`) REFERENCES `product_assets` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_product_asset_bases_base` FOREIGN KEY (`technology_base_id`) REFERENCES `technology_bases` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='产品与技术底座关联';

CREATE TABLE IF NOT EXISTS `product_asset_resources` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `product_asset_id` BIGINT UNSIGNED NOT NULL,
  `asset_id` BIGINT UNSIGNED NOT NULL,
  `relation_type` VARCHAR(64) NOT NULL DEFAULT 'runtime',
  `is_primary` TINYINT(1) NOT NULL DEFAULT 0,
  `created_by` VARCHAR(64) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_product_asset_resource` (`product_asset_id`, `asset_id`, `relation_type`),
  KEY `idx_product_asset_resource_asset` (`asset_id`),
  CONSTRAINT `fk_product_asset_resources_product` FOREIGN KEY (`product_asset_id`) REFERENCES `product_assets` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_product_asset_resources_asset` FOREIGN KEY (`asset_id`) REFERENCES `asset_items` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='产品与资源资产关联';

CREATE TABLE IF NOT EXISTS `ip_assets` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `ip_code` VARCHAR(64) NOT NULL,
  `ip_name` VARCHAR(255) NOT NULL,
  `ip_type` VARCHAR(64) NOT NULL,
  `registration_no` VARCHAR(128) DEFAULT NULL,
  `right_holder` VARCHAR(255) DEFAULT NULL,
  `apply_date` DATE DEFAULT NULL,
  `effective_date` DATE DEFAULT NULL,
  `expires_at` DATE DEFAULT NULL,
  `status` VARCHAR(64) NOT NULL DEFAULT 'active',
  `owner_uid` VARCHAR(64) DEFAULT NULL,
  `notes` TEXT DEFAULT NULL,
  `created_by` VARCHAR(64) DEFAULT NULL,
  `updated_by` VARCHAR(64) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_ip_code` (`ip_code`),
  KEY `idx_ip_type_status` (`ip_type`, `status`),
  KEY `idx_ip_expires_at` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='知识产权资产主档';

CREATE TABLE IF NOT EXISTS `ip_asset_products` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `ip_asset_id` BIGINT UNSIGNED NOT NULL,
  `product_asset_id` BIGINT UNSIGNED NOT NULL,
  `created_by` VARCHAR(64) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_ip_asset_product` (`ip_asset_id`, `product_asset_id`),
  KEY `idx_ip_asset_products_product` (`product_asset_id`),
  CONSTRAINT `fk_ip_asset_products_ip` FOREIGN KEY (`ip_asset_id`) REFERENCES `ip_assets` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_ip_asset_products_product` FOREIGN KEY (`product_asset_id`) REFERENCES `product_assets` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='知识产权与产品关联';

CREATE TABLE IF NOT EXISTS `digital_assets` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `digital_code` VARCHAR(64) NOT NULL,
  `digital_name` VARCHAR(255) NOT NULL,
  `digital_type` VARCHAR(64) NOT NULL,
  `storage_location` VARCHAR(500) DEFAULT NULL,
  `owner_uid` VARCHAR(64) DEFAULT NULL,
  `access_scope` VARCHAR(64) NOT NULL DEFAULT 'project',
  `project_code` VARCHAR(191) DEFAULT NULL,
  `environment_id` BIGINT UNSIGNED DEFAULT NULL,
  `status` VARCHAR(64) NOT NULL DEFAULT 'active',
  `notes` TEXT DEFAULT NULL,
  `created_by` VARCHAR(64) DEFAULT NULL,
  `updated_by` VARCHAR(64) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_digital_code` (`digital_code`),
  KEY `idx_digital_type_status` (`digital_type`, `status`),
  KEY `idx_digital_project_code` (`project_code`),
  CONSTRAINT `fk_digital_environment` FOREIGN KEY (`environment_id`) REFERENCES `asset_environments` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='数字资产主档';

CREATE TABLE IF NOT EXISTS `digital_asset_products` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `digital_asset_id` BIGINT UNSIGNED NOT NULL,
  `product_asset_id` BIGINT UNSIGNED NOT NULL,
  `created_by` VARCHAR(64) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_digital_asset_product` (`digital_asset_id`, `product_asset_id`),
  KEY `idx_digital_asset_products_product` (`product_asset_id`),
  CONSTRAINT `fk_digital_asset_products_digital` FOREIGN KEY (`digital_asset_id`) REFERENCES `digital_assets` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_digital_asset_products_product` FOREIGN KEY (`product_asset_id`) REFERENCES `product_assets` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='数字资产与产品关联';

CREATE TABLE IF NOT EXISTS `suppliers` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `supplier_code` VARCHAR(64) NOT NULL,
  `supplier_name` VARCHAR(255) NOT NULL,
  `credit_code` VARCHAR(64) DEFAULT NULL COMMENT '统一社会信用代码',
  `supplier_type` ENUM('hardware', 'software', 'cloud', 'ai', 'security', 'service', 'other') NOT NULL DEFAULT 'service',
  `contact_name` VARCHAR(100) DEFAULT NULL,
  `contact_phone` VARCHAR(50) DEFAULT NULL,
  `contact_email` VARCHAR(100) DEFAULT NULL,
  `invoice_info` TEXT DEFAULT NULL,
  `status` ENUM('active', 'disabled') NOT NULL DEFAULT 'active',
  `notes` TEXT DEFAULT NULL,
  `created_by` VARCHAR(64) DEFAULT NULL,
  `updated_by` VARCHAR(64) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_supplier_code` (`supplier_code`),
  UNIQUE KEY `uk_supplier_name` (`supplier_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='供应商基础台账';

CREATE TABLE IF NOT EXISTS `purchase_orders` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `order_no` VARCHAR(64) NOT NULL,
  `purchase_type` ENUM('physical', 'resource', 'mixed') NOT NULL DEFAULT 'physical',
  `purpose_type` VARCHAR(64) NOT NULL DEFAULT 'self_use' COMMENT '采购目的：self_use/project_procurement/sales_stock',
  `applicant_uid` VARCHAR(64) NOT NULL,
  `applicant_dept_code` VARCHAR(64) NOT NULL,
  `project_code` VARCHAR(191) DEFAULT NULL,
  `customer_code` VARCHAR(64) DEFAULT NULL,
  `contract_code` VARCHAR(64) DEFAULT NULL,
  `environment_id` BIGINT UNSIGNED DEFAULT NULL,
  `supplier_id` BIGINT UNSIGNED DEFAULT NULL,
  `budget_amount` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `actual_amount` DECIMAL(12,2) DEFAULT NULL,
  `status` ENUM('draft', 'pending_approval', 'approved', 'ordered', 'received', 'stocked', 'completed', 'rejected', 'closed') NOT NULL DEFAULT 'draft',
  `workflow_instance_id` VARCHAR(128) DEFAULT NULL,
  `reason` VARCHAR(500) DEFAULT NULL,
  `attachments` JSON DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_order_no` (`order_no`),
  KEY `idx_purchase_project_status` (`project_code`, `status`),
  KEY `idx_purchase_supplier` (`supplier_id`),
  CONSTRAINT `fk_purchase_environment` FOREIGN KEY (`environment_id`) REFERENCES `asset_environments` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_purchase_supplier` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='采购单';

CREATE TABLE IF NOT EXISTS `purchase_order_items` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `purchase_order_id` BIGINT UNSIGNED NOT NULL,
  `line_no` SMALLINT UNSIGNED NOT NULL,
  `asset_category` ENUM('physical', 'resource') NOT NULL,
  `asset_subtype` VARCHAR(64) NOT NULL,
  `item_name` VARCHAR(255) NOT NULL,
  `specification` VARCHAR(255) DEFAULT NULL,
  `quantity` DECIMAL(12,2) NOT NULL DEFAULT 1.00,
  `unit` VARCHAR(32) DEFAULT NULL,
  `unit_price` DECIMAL(12,2) DEFAULT NULL,
  `total_price` DECIMAL(12,2) DEFAULT NULL,
  `effective_at` DATE DEFAULT NULL,
  `expires_at` DATE DEFAULT NULL,
  `target_type` ENUM('none', 'user', 'dept', 'project', 'environment', 'system') NOT NULL DEFAULT 'none',
  `target_ref` VARCHAR(191) DEFAULT NULL,
  `remark` VARCHAR(255) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_purchase_line_no` (`purchase_order_id`, `line_no`),
  CONSTRAINT `fk_purchase_item_order` FOREIGN KEY (`purchase_order_id`) REFERENCES `purchase_orders` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='采购单明细';

CREATE TABLE IF NOT EXISTS `asset_receipts` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `receipt_no` VARCHAR(64) NOT NULL,
  `purchase_order_id` BIGINT UNSIGNED NOT NULL,
  `receipt_type` ENUM('physical_stock_in', 'resource_activation', 'resource_registration') NOT NULL,
  `status` ENUM('draft', 'processed', 'cancelled') NOT NULL DEFAULT 'draft',
  `operator_uid` VARCHAR(64) DEFAULT NULL,
  `processed_at` DATETIME DEFAULT NULL,
  `note` VARCHAR(500) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_receipt_no` (`receipt_no`),
  KEY `idx_receipt_order` (`purchase_order_id`),
  CONSTRAINT `fk_receipt_order` FOREIGN KEY (`purchase_order_id`) REFERENCES `purchase_orders` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='入库/激活/登记记录';

CREATE TABLE IF NOT EXISTS `asset_assignments` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `assignment_no` VARCHAR(64) NOT NULL,
  `asset_id` BIGINT UNSIGNED NOT NULL,
  `action_type` ENUM('assign', 'claim', 'transfer', 'return', 'renew', 'release', 'scrap', 'repair', 'revoke_access', 'rotate_secret') NOT NULL,
  `source_type` ENUM('stock', 'user', 'dept', 'project', 'environment', 'system', 'vendor', 'other') NOT NULL DEFAULT 'stock',
  `source_ref` VARCHAR(191) DEFAULT NULL,
  `target_type` ENUM('none', 'user', 'dept', 'project', 'environment', 'system', 'storage') NOT NULL DEFAULT 'none',
  `target_ref` VARCHAR(191) DEFAULT NULL,
  `quantity` DECIMAL(12,2) DEFAULT NULL,
  `status` ENUM('pending', 'active', 'returned', 'released', 'completed', 'cancelled') NOT NULL DEFAULT 'active',
  `workflow_instance_id` VARCHAR(128) DEFAULT NULL,
  `requested_by` VARCHAR(64) DEFAULT NULL,
  `approved_by` VARCHAR(64) DEFAULT NULL,
  `effective_at` DATETIME DEFAULT NULL,
  `ended_at` DATETIME DEFAULT NULL,
  `note` VARCHAR(500) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_assignment_no` (`assignment_no`),
  KEY `idx_assignment_asset` (`asset_id`),
  KEY `idx_assignment_target` (`target_type`, `target_ref`),
  CONSTRAINT `fk_assignment_asset` FOREIGN KEY (`asset_id`) REFERENCES `asset_items` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='资产分配与变更记录';

CREATE TABLE IF NOT EXISTS `asset_alerts` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `alert_no` VARCHAR(64) NOT NULL,
  `alert_type` ENUM('resource_expiring', 'subscription_expiring', 'domain_expiring', 'quota_low', 'seat_over_allocated', 'ai_quota_low', 'physical_overdue', 'offboarding_unrecovered', 'ip_expiring', 'idle_asset') NOT NULL,
  `severity` ENUM('low', 'medium', 'high', 'critical') NOT NULL DEFAULT 'medium',
  `asset_id` BIGINT UNSIGNED DEFAULT NULL,
  `environment_id` BIGINT UNSIGNED DEFAULT NULL,
  `delivery_view_id` BIGINT UNSIGNED DEFAULT NULL,
  `project_code` VARCHAR(191) DEFAULT NULL,
  `status` ENUM('pending', 'acknowledged', 'snoozed', 'resolved', 'ignored') NOT NULL DEFAULT 'pending',
  `title` VARCHAR(255) NOT NULL,
  `description` TEXT DEFAULT NULL,
  `triggered_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `due_at` DATETIME DEFAULT NULL,
  `next_remind_at` DATETIME DEFAULT NULL,
  `handled_by` VARCHAR(64) DEFAULT NULL,
  `handled_at` DATETIME DEFAULT NULL,
  `resolution` VARCHAR(500) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_alert_no` (`alert_no`),
  KEY `idx_alert_status_type` (`status`, `alert_type`),
  KEY `idx_alert_asset` (`asset_id`),
  KEY `idx_alert_environment` (`environment_id`),
  CONSTRAINT `fk_alert_asset` FOREIGN KEY (`asset_id`) REFERENCES `asset_items` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_alert_environment` FOREIGN KEY (`environment_id`) REFERENCES `asset_environments` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_alert_delivery` FOREIGN KEY (`delivery_view_id`) REFERENCES `asset_delivery_views` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='预警实例';

CREATE TABLE IF NOT EXISTS `asset_monthly_costs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `asset_id` BIGINT UNSIGNED NOT NULL,
  `cost_month` DATE NOT NULL COMMENT '月份，统一取每月第一天',
  `amount` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `cost_source` ENUM('manual', 'bill_sync', 'allocation') NOT NULL DEFAULT 'manual',
  `project_code` VARCHAR(191) DEFAULT NULL,
  `customer_code` VARCHAR(64) DEFAULT NULL,
  `contract_code` VARCHAR(64) DEFAULT NULL,
  `environment_id` BIGINT UNSIGNED DEFAULT NULL,
  `remark` VARCHAR(255) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_asset_cost_month` (`asset_id`, `cost_month`, `project_code`, `contract_code`),
  KEY `idx_cost_project_month` (`project_code`, `cost_month`),
  CONSTRAINT `fk_monthly_cost_asset` FOREIGN KEY (`asset_id`) REFERENCES `asset_items` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_monthly_cost_environment` FOREIGN KEY (`environment_id`) REFERENCES `asset_environments` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='月度成本记录';

CREATE TABLE IF NOT EXISTS `asset_events` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `object_type` ENUM('asset', 'environment', 'delivery_view', 'customer_delivery_asset', 'purchase_order', 'assignment', 'alert', 'supplier', 'product_asset', 'technology_base', 'ip_asset', 'digital_asset') NOT NULL,
  `object_id` BIGINT UNSIGNED NOT NULL,
  `event_type` VARCHAR(64) NOT NULL,
  `event_data` JSON DEFAULT NULL,
  `operator_uid` VARCHAR(64) DEFAULT NULL,
  `occurred_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_event_object` (`object_type`, `object_id`),
  KEY `idx_event_type_time` (`event_type`, `occurred_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='统一操作日志';
