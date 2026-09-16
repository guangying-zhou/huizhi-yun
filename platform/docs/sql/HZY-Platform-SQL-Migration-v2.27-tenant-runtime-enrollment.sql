-- Tenant Runtime enrollment, instance identity, application bindings and heartbeat.
-- Safe to rerun: all objects use CREATE TABLE IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS `tenant_runtime_instances` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `runtime_code` VARCHAR(128) NOT NULL,
  `tenant_code` VARCHAR(64) NOT NULL,
  `environment` VARCHAR(32) NOT NULL DEFAULT 'prod',
  `status` VARCHAR(32) NOT NULL DEFAULT 'pending'
    COMMENT 'pending / enrollment_issued / enrolled / ready / unhealthy / revoked',
  `runtime_endpoint` VARCHAR(500) NULL,
  `desired_version` VARCHAR(64) NOT NULL,
  `current_version` VARCHAR(64) NULL,
  `release_signing_key_id` VARCHAR(64) NOT NULL,
  `runtime_token_hash` VARCHAR(128) NULL,
  `runtime_token_last4` VARCHAR(8) NULL,
  `control_token_hash` VARCHAR(128) NULL,
  `control_token_last4` VARCHAR(8) NULL,
  `enrolled_at` DATETIME NULL,
  `last_heartbeat_at` DATETIME NULL,
  `last_error_code` VARCHAR(128) NULL,
  `last_error_message` VARCHAR(1000) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_runtime_instances_code` (`runtime_code`),
  UNIQUE KEY `uk_tenant_runtime_instances_tenant_env` (`tenant_code`, `environment`),
  KEY `idx_tenant_runtime_instances_status` (`status`, `last_heartbeat_at`),
  CONSTRAINT `fk_tenant_runtime_instances_tenant`
    FOREIGN KEY (`tenant_code`) REFERENCES `tenants` (`tenant_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tenant_runtime_instance_apps` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `runtime_instance_id` BIGINT UNSIGNED NOT NULL,
  `deployment_id` BIGINT UNSIGNED NOT NULL,
  `app_code` VARCHAR(64) NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'pending'
    COMMENT 'pending / runtime_ready / schema_ready / active / blocked',
  `schema_status` VARCHAR(32) NOT NULL DEFAULT 'unknown',
  `schema_version` VARCHAR(64) NULL,
  `last_error_code` VARCHAR(128) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_runtime_instance_apps_app` (`runtime_instance_id`, `app_code`),
  UNIQUE KEY `uk_tenant_runtime_instance_apps_deployment` (`runtime_instance_id`, `deployment_id`),
  KEY `idx_tenant_runtime_instance_apps_deployment` (`deployment_id`, `status`),
  CONSTRAINT `fk_tenant_runtime_instance_apps_instance`
    FOREIGN KEY (`runtime_instance_id`) REFERENCES `tenant_runtime_instances` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_tenant_runtime_instance_apps_deployment`
    FOREIGN KEY (`deployment_id`) REFERENCES `deployments` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tenant_runtime_enrollments` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `runtime_instance_id` BIGINT UNSIGNED NOT NULL,
  `code_hash` VARCHAR(128) NOT NULL,
  `code_last4` VARCHAR(8) NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'issued'
    COMMENT 'issued / redeemed / expired / revoked',
  `expires_at` DATETIME NOT NULL,
  `redeemed_at` DATETIME NULL,
  `revoked_at` DATETIME NULL,
  `issued_by_account_id` BIGINT UNSIGNED NULL COMMENT '跨域→platform_accounts，无 FK',
  `attempt_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `last_error_code` VARCHAR(128) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_runtime_enrollments_hash` (`code_hash`),
  KEY `idx_tenant_runtime_enrollments_instance_status` (`runtime_instance_id`, `status`, `expires_at`),
  CONSTRAINT `fk_tenant_runtime_enrollments_instance`
    FOREIGN KEY (`runtime_instance_id`) REFERENCES `tenant_runtime_instances` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tenant_runtime_heartbeats` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `runtime_instance_id` BIGINT UNSIGNED NOT NULL,
  `runtime_version` VARCHAR(64) NOT NULL,
  `release_signing_key_id` VARCHAR(64) NULL,
  `runtime_endpoint` VARCHAR(500) NULL,
  `apps_json` JSON NULL,
  `database_status` VARCHAR(32) NOT NULL DEFAULT 'unknown',
  `heartbeat_at` DATETIME NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_tenant_runtime_heartbeats_instance_time` (`runtime_instance_id`, `heartbeat_at`),
  CONSTRAINT `fk_tenant_runtime_heartbeats_instance`
    FOREIGN KEY (`runtime_instance_id`) REFERENCES `tenant_runtime_instances` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
