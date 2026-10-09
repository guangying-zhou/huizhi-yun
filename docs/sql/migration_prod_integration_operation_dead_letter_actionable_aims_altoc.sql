-- 生产补建缺失表：integration_operation_dead_letter_actionable（hzy_aims / hzy_altoc）
-- Date: 2026-08-23
--
-- 背景：`/v1/{app}/integration-operations:pending-dead-letter-actionables` 在 aims 和 altoc
-- 上稳定 500（durationMs=1，MySQL "Table doesn't exist" 立即报错），导致这两个应用的
-- outbox drain 每 5 分钟整体失败——该查询是 drain 的第一步，失败后一条 operation 都领不到。
--
-- 生产现状核查（information_schema）：
--   hzy_assets  / hzy_finance / hzy_people  已有该表
--   hzy_aims    / hzy_altoc                 缺失
-- 两个模块的 schema 文件（aims/docs/aims_schema.sql、altoc/docs/altoc_schema.sql）都已定义，
-- 只是迁移从未在生产执行。
--
-- 结构以生产 hzy_people 的实际 DDL 为基准，索引/约束名按各应用加前缀（与既有惯例一致）。
-- 纯新增表，不改动任何现有数据。执行前请确认 integration_operation 表已存在（外键依赖）。

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ---------------------------------------------------------------- hzy_aims

CREATE TABLE IF NOT EXISTS `hzy_aims`.`integration_operation_dead_letter_actionable` (
  `operation_id` CHAR(36) NOT NULL COMMENT '来源 integration operation UUID',
  `generation_no` BIGINT UNSIGNED NOT NULL COMMENT '进入 dead_letter 时的 operation version，单调 generation',
  `tenant_code` VARCHAR(100) NOT NULL,
  `deployment_code` VARCHAR(100) NOT NULL,
  `source_app` VARCHAR(64) NOT NULL,
  `target_app` VARCHAR(64) NOT NULL,
  `operation_code` VARCHAR(191) NOT NULL,
  `source_biz_type` VARCHAR(64) NOT NULL,
  `source_biz_code` VARCHAR(191) NOT NULL,
  `attempt_count` INT UNSIGNED NOT NULL,
  `max_attempts` INT UNSIGNED NOT NULL,
  `last_error_code` VARCHAR(100) DEFAULT NULL COMMENT '安全稳定错误码；不保存 raw error',
  `last_error_class` VARCHAR(50) DEFAULT NULL,
  `dead_lettered_at` DATETIME(3) NOT NULL,
  `original_actor_uid` VARCHAR(100) DEFAULT NULL,
  `source_operation_version` BIGINT UNSIGNED NOT NULL,
  `actionable_key` VARCHAR(191) NOT NULL,
  `publish_object_version` VARCHAR(191) NOT NULL,
  `notification_id` VARCHAR(64) DEFAULT NULL,
  `recipient_uids` JSON DEFAULT NULL COMMENT 'Console 返回的规范化显式收件 UID 数组',
  `publish_acked_at` DATETIME(3) DEFAULT NULL,
  `closure_state` VARCHAR(16) DEFAULT NULL COMMENT 'resolved/cancelled',
  `closure_object_version` VARCHAR(191) DEFAULT NULL,
  `closure_pending_at` DATETIME(3) DEFAULT NULL,
  `closure_acked_at` DATETIME(3) DEFAULT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`operation_id`, `generation_no`),
  UNIQUE KEY `uk_aims_iopdla_actionable` (`tenant_code`, `deployment_code`, `source_app`, `actionable_key`),
  UNIQUE KEY `uk_aims_iopdla_notification` (`tenant_code`, `deployment_code`, `source_app`, `notification_id`),
  KEY `idx_aims_iopdla_publish` (`tenant_code`, `deployment_code`, `source_app`, `publish_acked_at`, `dead_lettered_at`),
  KEY `idx_aims_iopdla_closure` (`tenant_code`, `deployment_code`, `source_app`, `closure_acked_at`, `closure_pending_at`),
  CONSTRAINT `fk_aims_iopdla_operation` FOREIGN KEY (`operation_id`)
    REFERENCES `integration_operation` (`operation_id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_aims_iopdla_closure` CHECK (`closure_state` IS NULL OR `closure_state` IN ('resolved', 'cancelled')),
  CONSTRAINT `chk_aims_iopdla_recipient` CHECK (`recipient_uids` IS NULL OR JSON_TYPE(`recipient_uids`) = 'ARRAY')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Aims 跨应用死信 actionable generation 发布与 closure 证据';

-- --------------------------------------------------------------- hzy_altoc

CREATE TABLE IF NOT EXISTS `hzy_altoc`.`integration_operation_dead_letter_actionable` (
  `operation_id` CHAR(36) NOT NULL COMMENT '来源 integration operation UUID',
  `generation_no` BIGINT UNSIGNED NOT NULL COMMENT '进入 dead_letter 时的 operation version，单调 generation',
  `tenant_code` VARCHAR(100) NOT NULL,
  `deployment_code` VARCHAR(100) NOT NULL,
  `source_app` VARCHAR(64) NOT NULL,
  `target_app` VARCHAR(64) NOT NULL,
  `operation_code` VARCHAR(191) NOT NULL,
  `source_biz_type` VARCHAR(64) NOT NULL,
  `source_biz_code` VARCHAR(191) NOT NULL,
  `attempt_count` INT UNSIGNED NOT NULL,
  `max_attempts` INT UNSIGNED NOT NULL,
  `last_error_code` VARCHAR(100) DEFAULT NULL COMMENT '安全稳定错误码；不保存 raw error',
  `last_error_class` VARCHAR(50) DEFAULT NULL,
  `dead_lettered_at` DATETIME(3) NOT NULL,
  `original_actor_uid` VARCHAR(100) DEFAULT NULL,
  `source_operation_version` BIGINT UNSIGNED NOT NULL,
  `actionable_key` VARCHAR(191) NOT NULL,
  `publish_object_version` VARCHAR(191) NOT NULL,
  `notification_id` VARCHAR(64) DEFAULT NULL,
  `recipient_uids` JSON DEFAULT NULL COMMENT 'Console 返回的规范化显式收件 UID 数组',
  `publish_acked_at` DATETIME(3) DEFAULT NULL,
  `closure_state` VARCHAR(16) DEFAULT NULL COMMENT 'resolved/cancelled',
  `closure_object_version` VARCHAR(191) DEFAULT NULL,
  `closure_pending_at` DATETIME(3) DEFAULT NULL,
  `closure_acked_at` DATETIME(3) DEFAULT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`operation_id`, `generation_no`),
  UNIQUE KEY `uk_altoc_iopdla_actionable` (`tenant_code`, `deployment_code`, `source_app`, `actionable_key`),
  UNIQUE KEY `uk_altoc_iopdla_notification` (`tenant_code`, `deployment_code`, `source_app`, `notification_id`),
  KEY `idx_altoc_iopdla_publish` (`tenant_code`, `deployment_code`, `source_app`, `publish_acked_at`, `dead_lettered_at`),
  KEY `idx_altoc_iopdla_closure` (`tenant_code`, `deployment_code`, `source_app`, `closure_acked_at`, `closure_pending_at`),
  CONSTRAINT `fk_altoc_iopdla_operation` FOREIGN KEY (`operation_id`)
    REFERENCES `integration_operation` (`operation_id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_altoc_iopdla_closure` CHECK (`closure_state` IS NULL OR `closure_state` IN ('resolved', 'cancelled')),
  CONSTRAINT `chk_altoc_iopdla_recipient` CHECK (`recipient_uids` IS NULL OR JSON_TYPE(`recipient_uids`) = 'ARRAY')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Altoc 跨应用死信 actionable generation 发布与 closure 证据';

-- 核验：以下应返回 5 行（aims / altoc / assets / finance / people）
-- SELECT TABLE_SCHEMA FROM information_schema.TABLES
-- WHERE TABLE_NAME = 'integration_operation_dead_letter_actionable'
-- ORDER BY TABLE_SCHEMA;
