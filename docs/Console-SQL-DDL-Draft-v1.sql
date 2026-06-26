-- hzy_console 第一版 SQL DDL 草案
-- 配套：docs/Console-Functional-Design-v1.md
--
-- 设计骨架：
--   Section A: Tenant Profile
--   Section B: System Settings
--   Section C: Credential Vault
--   Section D: Integration Config
--   Section E: Service Clients
--   Section F: Directory Runtime
--   Section G: Auth Runtime
--   Section H: Generic Audit
--
-- 约定：
--   - MySQL 8.0+
--   - utf8mb4 / utf8mb4_unicode_ci
--   - 所有 secret 明文不得直接落库
--   - vault 对外以 `secret_ref` 标识秘密对象，关系表内部通过 `secret_id` 关联本地 vault
--   - 第一版按“一个 console 实例对应一个企业环境”建模，`tenant_code` 只保存在 `org_profiles`
--   - 第一版不支持同一集成/同一服务客户端的并行生效凭证
--   - 高频日志表在真实部署中建议分区或冷热分层

CREATE DATABASE IF NOT EXISTS `hzy_console`
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

USE `hzy_console`;

-- ============================================================
-- Section A: Tenant Profile
-- ============================================================

CREATE TABLE IF NOT EXISTS `org_profiles` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `singleton_key` TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '单实例单企业约束键，整库仅允许一行',
  `tenant_code` VARCHAR(64) NOT NULL,
  `org_name` VARCHAR(255) NOT NULL,
  `org_short_name` VARCHAR(128) NULL,
  `display_name` VARCHAR(255) NULL,
  `legal_name` VARCHAR(255) NULL,
  `unified_social_credit_code` VARCHAR(64) NULL,
  `logo_path` VARCHAR(500) NULL,
  `website_url` VARCHAR(255) NULL,
  `industry_code` VARCHAR(64) NULL,
  `country_code` VARCHAR(8) NOT NULL DEFAULT 'CN',
  `timezone` VARCHAR(64) NOT NULL DEFAULT 'Asia/Shanghai',
  `locale` VARCHAR(32) NOT NULL DEFAULT 'zh-CN',
  `currency_code` VARCHAR(16) NOT NULL DEFAULT 'CNY',
  `contact_name` VARCHAR(128) NULL,
  `contact_email` VARCHAR(255) NULL,
  `contact_mobile` VARCHAR(64) NULL,
  `address_text` VARCHAR(500) NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_org_profiles_singleton` (`singleton_key`),
  UNIQUE KEY `uk_org_profiles_tenant` (`tenant_code`),
  KEY `idx_org_profiles_status` (`status`),
  CONSTRAINT `ck_org_profiles_singleton_key`
    CHECK (`singleton_key` = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `org_business_domains` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `domain_code` VARCHAR(64) NOT NULL,
  `domain_name` VARCHAR(255) NOT NULL,
  `category` VARCHAR(16) NOT NULL DEFAULT '2B' COMMENT '业务领域大类：2G/2B/2C',
  `alias_name` VARCHAR(255) NULL COMMENT '企业内显示别名，为空时使用 domain_name',
  `parent_id` BIGINT UNSIGNED NULL,
  `description` VARCHAR(500) NULL,
  `source` VARCHAR(32) NOT NULL DEFAULT 'custom',
  `sort_order` INT NOT NULL DEFAULT 100,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_org_business_domains` (`domain_code`),
  KEY `idx_org_business_domains_category` (`category`, `sort_order`),
  KEY `idx_org_business_domains_status` (`status`, `sort_order`),
  KEY `idx_org_business_domains_parent` (`parent_id`),
  CONSTRAINT `fk_org_business_domains_parent`
    FOREIGN KEY (`parent_id`) REFERENCES `org_business_domains` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `regions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `region_code` VARCHAR(64) NOT NULL,
  `region_name` VARCHAR(255) NOT NULL,
  `region_type` VARCHAR(32) NOT NULL DEFAULT 'custom',
  `parent_id` BIGINT UNSIGNED NULL,
  `description` VARCHAR(500) NULL,
  `sort_order` INT NOT NULL DEFAULT 100,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_regions` (`region_code`),
  KEY `idx_regions_status` (`status`, `sort_order`),
  KEY `idx_regions_parent` (`parent_id`),
  CONSTRAINT `fk_regions_parent`
    FOREIGN KEY (`parent_id`) REFERENCES `regions` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `region_divisions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `region_id` BIGINT UNSIGNED NOT NULL,
  `division_code` VARCHAR(32) NOT NULL,
  `division_name` VARCHAR(255) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_region_divisions` (`region_id`, `division_code`),
  KEY `idx_region_divisions_code` (`division_code`),
  CONSTRAINT `fk_region_divisions_region`
    FOREIGN KEY (`region_id`) REFERENCES `regions` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- Section B: System Settings
-- ============================================================

CREATE TABLE IF NOT EXISTS `setting_catalogs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `setting_key` VARCHAR(128) NOT NULL,
  `setting_name` VARCHAR(255) NOT NULL,
  `value_type` VARCHAR(32) NOT NULL DEFAULT 'string',
  `scope_type` VARCHAR(32) NOT NULL DEFAULT 'tenant',
  `category` VARCHAR(64) NOT NULL DEFAULT 'general',
  `default_value_json` JSON NULL,
  `validator_json` JSON NULL,
  `is_required` TINYINT(1) NOT NULL DEFAULT 0,
  `editable_in_ui` TINYINT(1) NOT NULL DEFAULT 1,
  `description` VARCHAR(500) NULL COMMENT 'system-settings 仅承接非 secret 参数；涉及凭证时改由 integration-config + vault 引用建模',
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_setting_catalogs_key` (`setting_key`),
  KEY `idx_setting_catalogs_category` (`category`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `setting_values` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `setting_key` VARCHAR(128) NOT NULL,
  `scope_key` VARCHAR(128) NOT NULL DEFAULT '__tenant__',
  `value_json` JSON NOT NULL,
  `source` VARCHAR(32) NOT NULL DEFAULT 'custom',
  `updated_by` VARCHAR(64) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_setting_values` (`setting_key`, `scope_key`),
  KEY `idx_setting_values_key` (`setting_key`),
  CONSTRAINT `fk_setting_values_catalog`
    FOREIGN KEY (`setting_key`) REFERENCES `setting_catalogs` (`setting_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `dictionaries` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `dictionary_code` VARCHAR(128) NOT NULL,
  `dictionary_name` VARCHAR(255) NOT NULL,
  `description` VARCHAR(500) NULL,
  `source` VARCHAR(32) NOT NULL DEFAULT 'custom',
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_dictionaries` (`dictionary_code`),
  KEY `idx_dictionaries_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `dictionary_items` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `dictionary_id` BIGINT UNSIGNED NOT NULL,
  `item_code` VARCHAR(128) NOT NULL,
  `item_name` VARCHAR(255) NOT NULL,
  `item_value` VARCHAR(255) NULL,
  `parent_id` BIGINT UNSIGNED NULL,
  `sort_order` INT NOT NULL DEFAULT 100,
  `extra_json` JSON NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_dictionary_items` (`dictionary_id`, `item_code`),
  UNIQUE KEY `uk_dictionary_items_id_dict` (`id`, `dictionary_id`),
  KEY `idx_dictionary_items_parent` (`parent_id`, `dictionary_id`),
  KEY `idx_dictionary_items_status` (`dictionary_id`, `status`, `sort_order`),
  CONSTRAINT `fk_dictionary_items_dict`
    FOREIGN KEY (`dictionary_id`) REFERENCES `dictionaries` (`id`),
  CONSTRAINT `fk_dictionary_items_parent`
    FOREIGN KEY (`parent_id`, `dictionary_id`) REFERENCES `dictionary_items` (`id`, `dictionary_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- Section C: Credential Vault
-- ============================================================

CREATE TABLE IF NOT EXISTS `vault_secrets` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `secret_code` VARCHAR(128) NOT NULL,
  `secret_ref` VARCHAR(255) NOT NULL COMMENT '例如 hzybase://vault/{secret_code}',
  `secret_name` VARCHAR(255) NOT NULL,
  `secret_type` VARCHAR(32) NOT NULL DEFAULT 'api_key',
  `usage_type` VARCHAR(32) NOT NULL DEFAULT 'integration' COMMENT 'integration / service / bootstrap / custody；由 API 层按类型执行访问策略',
  `owner_type` VARCHAR(32) NOT NULL DEFAULT 'system',
  `owner_key` VARCHAR(128) NULL,
  `storage_backend` VARCHAR(32) NOT NULL DEFAULT 'db_encrypted' COMMENT 'db_encrypted / env_ref / docker_secret / k8s_secret',
  `kms_key_ref` VARCHAR(255) NULL,
  `current_version_id` BIGINT UNSIGNED NULL,
  `reveal_policy` VARCHAR(32) NOT NULL DEFAULT 'approval',
  `rotate_policy_json` JSON NULL,
  `masked_preview` VARCHAR(128) NULL,
  `expires_at` DATETIME NULL,
  `last_rotated_at` DATETIME NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `created_by` VARCHAR(64) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_vault_secrets_code` (`secret_code`),
  UNIQUE KEY `uk_vault_secrets_ref` (`secret_ref`),
  KEY `idx_vault_secrets_owner` (`owner_type`, `owner_key`, `status`),
  KEY `idx_vault_secrets_status` (`status`, `expires_at`),
  CONSTRAINT `ck_vault_secrets_storage_backend_v1`
    CHECK (`storage_backend` IN ('db_encrypted', 'env_ref', 'docker_secret', 'k8s_secret'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `vault_secret_versions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `secret_id` BIGINT UNSIGNED NOT NULL,
  `version_no` INT NOT NULL,
  `ciphertext_blob` LONGBLOB NULL COMMENT '仅存加密后的密文，不存明文',
  `backend_secret_ref` VARCHAR(255) NULL COMMENT 'env / k8s secret / docker secret 引用',
  `content_hash` VARCHAR(128) NOT NULL,
  `encryption_scheme` VARCHAR(64) NOT NULL DEFAULT 'aes256-gcm',
  `key_fingerprint` VARCHAR(128) NULL,
  `rotated_from_id` BIGINT UNSIGNED NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `activated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `retired_at` DATETIME NULL,
  `created_by` VARCHAR(64) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_vault_secret_versions` (`secret_id`, `version_no`),
  UNIQUE KEY `uk_vault_secret_versions_id_secret` (`id`, `secret_id`),
  KEY `idx_vault_secret_versions_status` (`secret_id`, `status`, `activated_at`),
  KEY `idx_vault_secret_versions_rotated_from` (`rotated_from_id`, `secret_id`),
  CONSTRAINT `fk_vault_secret_versions_secret`
    FOREIGN KEY (`secret_id`) REFERENCES `vault_secrets` (`id`),
  CONSTRAINT `fk_vault_secret_versions_prev`
    FOREIGN KEY (`rotated_from_id`, `secret_id`) REFERENCES `vault_secret_versions` (`id`, `secret_id`),
  CONSTRAINT `ck_vault_secret_versions_material`
    CHECK ((`ciphertext_blob` IS NOT NULL) OR (`backend_secret_ref` IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `vault_secrets`
  ADD CONSTRAINT `fk_vault_secrets_current_version`
    FOREIGN KEY (`current_version_id`, `id`) REFERENCES `vault_secret_versions` (`id`, `secret_id`);

CREATE TABLE IF NOT EXISTS `vault_access_logs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `secret_id` BIGINT UNSIGNED NOT NULL,
  `version_id` BIGINT UNSIGNED NULL,
  `action` VARCHAR(32) NOT NULL COMMENT 'resolve / reveal / rotate / deactivate / validate',
  `actor_type` VARCHAR(32) NOT NULL DEFAULT 'system' COMMENT 'human / service / system',
  `actor_id` VARCHAR(128) NULL,
  `app_code` VARCHAR(64) NULL,
  `reason` VARCHAR(255) NULL,
  `approval_code` VARCHAR(64) NULL,
  `request_ip` VARCHAR(64) NULL,
  `user_agent` VARCHAR(500) NULL,
  `result_status` VARCHAR(32) NOT NULL DEFAULT 'success',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_vault_access_logs_secret_time` (`secret_id`, `created_at`),
  KEY `idx_vault_access_logs_version_secret` (`version_id`, `secret_id`),
  KEY `idx_vault_access_logs_actor_time` (`actor_type`, `actor_id`, `created_at`),
  KEY `idx_vault_access_logs_action_time` (`action`, `created_at`),
  CONSTRAINT `fk_vault_access_logs_secret`
    FOREIGN KEY (`secret_id`) REFERENCES `vault_secrets` (`id`),
  CONSTRAINT `fk_vault_access_logs_version`
    FOREIGN KEY (`version_id`, `secret_id`) REFERENCES `vault_secret_versions` (`id`, `secret_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- Section D: Integration Config
-- ============================================================

CREATE TABLE IF NOT EXISTS `integrations` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `integration_code` VARCHAR(128) NOT NULL,
  `integration_type` VARCHAR(32) NOT NULL COMMENT 'gitlab / ai_provider / wecom / oidc / oss / smtp / webhook',
  `integration_name` VARCHAR(255) NOT NULL,
  `category` VARCHAR(32) NOT NULL DEFAULT 'general',
  `provider_code` VARCHAR(64) NULL,
  `base_url` VARCHAR(255) NULL,
  `config_json` JSON NULL COMMENT '只存非 secret 配置，secret 统一走 integration_credentials -> vault_secrets',
  `current_credential_id` BIGINT UNSIGNED NULL,
  `connectivity_status` VARCHAR(32) NOT NULL DEFAULT 'unknown',
  `last_checked_at` DATETIME NULL,
  `last_error_message` VARCHAR(500) NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `created_by` VARCHAR(64) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_integrations_code` (`integration_code`),
  KEY `idx_integrations_type_status` (`integration_type`, `status`),
  KEY `idx_integrations_connectivity` (`connectivity_status`, `last_checked_at`),
  KEY `idx_integrations_current_credential_ref` (`current_credential_id`, `id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `integration_credentials` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `integration_id` BIGINT UNSIGNED NOT NULL,
  `credential_name` VARCHAR(128) NOT NULL DEFAULT 'primary',
  `credential_role` VARCHAR(32) NOT NULL DEFAULT 'primary' COMMENT 'v1 固定 primary，预留 future 扩展',
  `version_no` INT NOT NULL DEFAULT 1 COMMENT '同一 integration_id 下递增版本',
  `secret_id` BIGINT UNSIGNED NOT NULL COMMENT '必须引用本地 vault_secrets，不允许直连外部 secret 引用',
  `secret_version_id` BIGINT UNSIGNED NULL COMMENT '绑定到具体 vault_secret_versions；为空时兼容读取 vault 当前版本',
  `rotated_from_id` BIGINT UNSIGNED NULL,
  `issued_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expires_at` DATETIME NULL,
  `last_used_at` DATETIME NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `active_guard_integration_id` BIGINT UNSIGNED GENERATED ALWAYS AS (
    CASE WHEN `status` = 'active' THEN `integration_id` ELSE NULL END
  ) STORED,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_integration_credentials_version` (`integration_id`, `version_no`),
  UNIQUE KEY `uk_integration_credentials_id_integration` (`id`, `integration_id`),
  UNIQUE KEY `uk_integration_credentials_active` (`active_guard_integration_id`),
  KEY `idx_integration_credentials_status` (`integration_id`, `status`),
  KEY `idx_integration_credentials_secret` (`secret_id`),
  KEY `idx_integration_credentials_secret_version` (`secret_version_id`, `secret_id`),
  KEY `idx_integration_credentials_rotated_from` (`rotated_from_id`, `integration_id`),
  CONSTRAINT `fk_integration_credentials_integration`
    FOREIGN KEY (`integration_id`) REFERENCES `integrations` (`id`),
  CONSTRAINT `fk_integration_credentials_secret`
    FOREIGN KEY (`secret_id`) REFERENCES `vault_secrets` (`id`),
  CONSTRAINT `fk_integration_credentials_secret_version`
    FOREIGN KEY (`secret_version_id`, `secret_id`) REFERENCES `vault_secret_versions` (`id`, `secret_id`),
  CONSTRAINT `fk_integration_credentials_prev`
    FOREIGN KEY (`rotated_from_id`, `integration_id`) REFERENCES `integration_credentials` (`id`, `integration_id`),
  CONSTRAINT `ck_integration_credentials_role_v1`
    CHECK (`credential_role` = 'primary')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `integrations`
  ADD CONSTRAINT `fk_integrations_current_credential`
    FOREIGN KEY (`current_credential_id`, `id`) REFERENCES `integration_credentials` (`id`, `integration_id`);

CREATE TABLE IF NOT EXISTS `integration_check_logs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `integration_id` BIGINT UNSIGNED NOT NULL,
  `check_type` VARCHAR(32) NOT NULL DEFAULT 'connectivity',
  `trigger_source` VARCHAR(32) NOT NULL DEFAULT 'manual',
  `status` VARCHAR(32) NOT NULL,
  `request_summary_json` JSON NULL,
  `response_summary_json` JSON NULL,
  `error_message` VARCHAR(500) NULL,
  `checked_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_integration_check_logs_integration_time` (`integration_id`, `checked_at`),
  KEY `idx_integration_check_logs_status` (`status`, `checked_at`),
  CONSTRAINT `fk_integration_check_logs_integration`
    FOREIGN KEY (`integration_id`) REFERENCES `integrations` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- Section E: Service Clients
-- ============================================================

CREATE TABLE IF NOT EXISTS `service_clients` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `client_code` VARCHAR(128) NOT NULL,
  `client_name` VARCHAR(255) NOT NULL,
  `client_type` VARCHAR(32) NOT NULL DEFAULT 'app' COMMENT 'app / supporting_service / tool',
  `app_code` VARCHAR(64) NULL,
  `description` VARCHAR(500) NULL,
  `current_credential_id` BIGINT UNSIGNED NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_service_clients_code` (`client_code`),
  KEY `idx_service_clients_status` (`status`, `app_code`),
  KEY `idx_service_clients_current_credential_ref` (`current_credential_id`, `id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `service_client_credentials` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `service_client_id` BIGINT UNSIGNED NOT NULL,
  `client_id` VARCHAR(128) NOT NULL,
  `version_no` INT NOT NULL DEFAULT 1 COMMENT '同一 service_client_id 下递增版本',
  `secret_id` BIGINT UNSIGNED NOT NULL COMMENT '必须引用本地 vault_secrets，不允许直连外部 secret 引用',
  `rotated_from_id` BIGINT UNSIGNED NULL,
  `issued_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expires_at` DATETIME NULL,
  `last_used_at` DATETIME NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `active_guard_service_client_id` BIGINT UNSIGNED GENERATED ALWAYS AS (
    CASE WHEN `status` = 'active' THEN `service_client_id` ELSE NULL END
  ) STORED,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_service_client_credentials_client_id` (`client_id`),
  UNIQUE KEY `uk_service_client_credentials_client_version` (`service_client_id`, `version_no`),
  UNIQUE KEY `uk_service_client_credentials_id_client` (`id`, `service_client_id`),
  UNIQUE KEY `uk_service_client_credentials_active` (`active_guard_service_client_id`),
  KEY `idx_service_client_credentials_status` (`service_client_id`, `status`, `issued_at`),
  KEY `idx_service_client_credentials_secret` (`secret_id`),
  KEY `idx_service_client_credentials_rotated_from` (`rotated_from_id`, `service_client_id`),
  CONSTRAINT `fk_service_client_credentials_client`
    FOREIGN KEY (`service_client_id`) REFERENCES `service_clients` (`id`),
  CONSTRAINT `fk_service_client_credentials_secret`
    FOREIGN KEY (`secret_id`) REFERENCES `vault_secrets` (`id`),
  CONSTRAINT `fk_service_client_credentials_prev`
    FOREIGN KEY (`rotated_from_id`, `service_client_id`) REFERENCES `service_client_credentials` (`id`, `service_client_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `service_client_grants` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `service_client_id` BIGINT UNSIGNED NOT NULL,
  `resource_code` VARCHAR(128) NOT NULL,
  `action` VARCHAR(32) NOT NULL,
  `scope_json` JSON NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_service_client_grants` (`service_client_id`, `resource_code`, `action`),
  KEY `idx_service_client_grants_status` (`service_client_id`, `status`),
  CONSTRAINT `fk_service_client_grants_client`
    FOREIGN KEY (`service_client_id`) REFERENCES `service_clients` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `service_clients`
  ADD CONSTRAINT `fk_service_clients_current_credential`
    FOREIGN KEY (`current_credential_id`, `id`) REFERENCES `service_client_credentials` (`id`, `service_client_id`);

-- ============================================================
-- Section F: Directory Runtime
-- ============================================================

-- 参照 account.departments，但去掉 company_code，多租户隔离由单实例 console + org_profiles 承担。
CREATE TABLE IF NOT EXISTS `directory_departments` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `dept_code` VARCHAR(64) NOT NULL COMMENT '稳定部门编码，对齐 account.departments.dept_code',
  `dept_name` VARCHAR(255) NOT NULL COMMENT '部门显示名称，对齐 account.departments.name',
  `parent_id` BIGINT UNSIGNED NULL,
  `parent_dept_code` VARCHAR(64) NULL COMMENT '冗余父级编码，便于外部同步与导出',
  `dept_path` VARCHAR(500) NULL COMMENT '路径，如 /root/RD/',
  `level_no` INT NOT NULL DEFAULT 1,
  `sort_order` INT NOT NULL DEFAULT 100,
  `manager_uid` VARCHAR(64) NULL,
  `leader_uid` VARCHAR(64) NULL,
  `org_type` VARCHAR(32) NOT NULL DEFAULT 'department' COMMENT 'department / committee / virtual',
  `dept_category` VARCHAR(32) NULL COMMENT '行政/业务/管理等分类，兼容 account.dept_category',
  `description` VARCHAR(1000) NULL,
  `source_provider` VARCHAR(64) NOT NULL DEFAULT 'manual' COMMENT 'manual / account / ldap / wecom / dingtalk / hr',
  `external_ref` VARCHAR(255) NULL COMMENT '上游目录对象唯一标识',
  `source_payload_hash` VARCHAR(128) NULL COMMENT '上游源数据摘要，用于增量对账',
  `synced_at` DATETIME NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_directory_departments_code` (`dept_code`),
  UNIQUE KEY `uk_directory_departments_source_ref` (`source_provider`, `external_ref`),
  KEY `idx_directory_departments_parent` (`parent_id`),
  KEY `idx_directory_departments_parent_code` (`parent_dept_code`),
  KEY `idx_directory_departments_type_status` (`org_type`, `status`, `sort_order`),
  KEY `idx_directory_departments_sync` (`source_provider`, `synced_at`),
  CONSTRAINT `fk_directory_departments_parent`
    FOREIGN KEY (`parent_id`) REFERENCES `directory_departments` (`id`)
    ON DELETE SET NULL,
  CONSTRAINT `ck_directory_departments_status`
    CHECK (`status` IN ('active', 'inactive', 'deleted'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 参照 account.system_users / user_status_cache，作为客户侧目录用户主表。
CREATE TABLE IF NOT EXISTS `directory_users` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `uid` VARCHAR(64) NOT NULL COMMENT '稳定用户标识，对齐 account.system_users.uid',
  `username` VARCHAR(128) NULL,
  `display_name` VARCHAR(255) NULL COMMENT '显示名称，可来自 real_name / nickname',
  `real_name` VARCHAR(255) NULL COMMENT '客户侧可保存；不得同步到 platform tenant_subjects',
  `nickname` VARCHAR(128) NULL,
  `avatar_url` VARCHAR(500) NULL,
  `email` VARCHAR(255) NULL,
  `mobile` VARCHAR(64) NULL,
  `mobile_tail4` VARCHAR(8) NULL COMMENT '用于脱敏展示或匹配',
  `position_title` VARCHAR(128) NULL,
  `gender` VARCHAR(16) NOT NULL DEFAULT 'unknown',
  `timezone` VARCHAR(64) NOT NULL DEFAULT 'Asia/Shanghai',
  `locale` VARCHAR(32) NOT NULL DEFAULT 'zh-CN',
  `primary_dept_code` VARCHAR(64) NULL COMMENT '冗余主部门：来自 active directory_user_departments(member) 中 org_type=department 的唯一部门；committee 不写入',
  `user_type` VARCHAR(32) NOT NULL DEFAULT 'employee' COMMENT 'system / employee / external / service',
  `source_provider` VARCHAR(64) NOT NULL DEFAULT 'manual' COMMENT 'manual / account / ldap / wecom / dingtalk / oidc / hr',
  `external_ref` VARCHAR(255) NULL COMMENT '上游用户对象唯一标识',
  `source_payload_hash` VARCHAR(128) NULL,
  `last_login_at` DATETIME NULL,
  `last_login_ip` VARCHAR(64) NULL,
  `synced_at` DATETIME NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `remark` VARCHAR(500) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_directory_users_uid` (`uid`),
  UNIQUE KEY `uk_directory_users_source_ref` (`source_provider`, `external_ref`),
  KEY `idx_directory_users_email` (`email`),
  KEY `idx_directory_users_mobile` (`mobile`),
  KEY `idx_directory_users_primary_dept` (`primary_dept_code`),
  KEY `idx_directory_users_status` (`status`, `user_type`),
  KEY `idx_directory_users_sync` (`source_provider`, `synced_at`),
  CONSTRAINT `fk_directory_users_primary_dept`
    FOREIGN KEY (`primary_dept_code`) REFERENCES `directory_departments` (`dept_code`)
    ON DELETE SET NULL,
  CONSTRAINT `ck_directory_users_status`
    CHECK (`status` IN ('active', 'inactive', 'pending', 'deleted'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 参照 account.user_departments，支持用户主部门、委员会、虚拟组织。
-- 业务约束：每个用户最多一个 active member 关系指向 org_type=department 的部门；可同时拥有多个 committee/virtual 关系。
CREATE TABLE IF NOT EXISTS `directory_user_departments` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `uid` VARCHAR(64) NOT NULL,
  `dept_code` VARCHAR(64) NOT NULL,
  `relation_type` VARCHAR(32) NOT NULL DEFAULT 'member' COMMENT 'member / manager / leader / observer',
  `is_primary` TINYINT(1) NOT NULL DEFAULT 0,
  `source_provider` VARCHAR(64) NOT NULL DEFAULT 'manual',
  `external_ref` VARCHAR(255) NULL,
  `joined_at` DATETIME NULL,
  `left_at` DATETIME NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_directory_user_departments` (`uid`, `dept_code`, `relation_type`),
  KEY `idx_directory_user_departments_dept` (`dept_code`, `status`),
  KEY `idx_directory_user_departments_uid` (`uid`, `status`),
  KEY `idx_directory_user_departments_primary` (`uid`, `is_primary`),
  CONSTRAINT `fk_directory_user_departments_user`
    FOREIGN KEY (`uid`) REFERENCES `directory_users` (`uid`)
    ON DELETE CASCADE,
  CONSTRAINT `fk_directory_user_departments_dept`
    FOREIGN KEY (`dept_code`) REFERENCES `directory_departments` (`dept_code`)
    ON DELETE CASCADE,
  CONSTRAINT `ck_directory_user_departments_status`
    CHECK (`status` IN ('active', 'inactive', 'deleted'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 参照 account.git_projects / git_project_members，但定位为“项目注册表”，不承载业务项目执行状态。
CREATE TABLE IF NOT EXISTS `directory_projects` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `project_code` VARCHAR(128) NOT NULL COMMENT '跨模块稳定项目编码',
  `parent_project_code` VARCHAR(128) NULL,
  `project_name` VARCHAR(255) NOT NULL,
  `project_type` VARCHAR(32) NOT NULL DEFAULT 'project' COMMENT 'group / project / template',
  `dept_code` VARCHAR(64) NULL,
  `owner_uid` VARCHAR(64) NULL,
  `leader_uid` VARCHAR(64) NULL,
  `repo_url` VARCHAR(500) NULL COMMENT '仅作目录注册表字段；具体 Git 同步逻辑不属于 console',
  `description` VARCHAR(1000) NULL,
  `source_provider` VARCHAR(64) NOT NULL DEFAULT 'manual' COMMENT 'manual / account / gitlab / aims / hr',
  `external_ref` VARCHAR(255) NULL,
  `source_payload_hash` VARCHAR(128) NULL,
  `synced_at` DATETIME NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_directory_projects_code` (`project_code`),
  UNIQUE KEY `uk_directory_projects_source_ref` (`source_provider`, `external_ref`),
  KEY `idx_directory_projects_parent` (`parent_project_code`),
  KEY `idx_directory_projects_dept` (`dept_code`, `status`),
  KEY `idx_directory_projects_owner` (`owner_uid`),
  KEY `idx_directory_projects_leader` (`leader_uid`),
  KEY `idx_directory_projects_sync` (`source_provider`, `synced_at`),
  CONSTRAINT `fk_directory_projects_parent`
    FOREIGN KEY (`parent_project_code`) REFERENCES `directory_projects` (`project_code`)
    ON DELETE SET NULL,
  CONSTRAINT `fk_directory_projects_dept`
    FOREIGN KEY (`dept_code`) REFERENCES `directory_departments` (`dept_code`)
    ON DELETE SET NULL,
  CONSTRAINT `fk_directory_projects_owner`
    FOREIGN KEY (`owner_uid`) REFERENCES `directory_users` (`uid`)
    ON DELETE SET NULL,
  CONSTRAINT `fk_directory_projects_leader`
    FOREIGN KEY (`leader_uid`) REFERENCES `directory_users` (`uid`)
    ON DELETE SET NULL,
  CONSTRAINT `ck_directory_projects_status`
    CHECK (`status` IN ('active', 'inactive', 'archived', 'deleted'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `directory_project_members` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `project_code` VARCHAR(128) NOT NULL,
  `uid` VARCHAR(64) NOT NULL,
  `member_role` VARCHAR(32) NOT NULL DEFAULT 'member' COMMENT 'member / admin / owner / viewer',
  `source_provider` VARCHAR(64) NOT NULL DEFAULT 'manual',
  `external_ref` VARCHAR(255) NULL,
  `joined_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `left_at` DATETIME NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_directory_project_members` (`project_code`, `uid`, `member_role`),
  KEY `idx_directory_project_members_uid` (`uid`, `status`),
  KEY `idx_directory_project_members_project` (`project_code`, `status`),
  CONSTRAINT `fk_directory_project_members_project`
    FOREIGN KEY (`project_code`) REFERENCES `directory_projects` (`project_code`)
    ON DELETE CASCADE,
  CONSTRAINT `fk_directory_project_members_user`
    FOREIGN KEY (`uid`) REFERENCES `directory_users` (`uid`)
    ON DELETE CASCADE,
  CONSTRAINT `ck_directory_project_members_status`
    CHECK (`status` IN ('active', 'inactive', 'deleted'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 外部身份映射，承接 LDAP / CAS / OIDC / 企业微信 / 钉钉等 provider 到本地 uid 的解析。
CREATE TABLE IF NOT EXISTS `directory_identities` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `uid` VARCHAR(64) NOT NULL,
  `provider_code` VARCHAR(64) NOT NULL COMMENT 'ldap / cas / oidc / wecom / dingtalk / account',
  `provider_subject` VARCHAR(255) NOT NULL COMMENT '上游身份唯一标识，如 LDAP uid / OIDC sub / WeCom userid',
  `provider_username` VARCHAR(255) NULL,
  `provider_dn` VARCHAR(500) NULL,
  `email` VARCHAR(255) NULL,
  `mobile_tail4` VARCHAR(8) NULL,
  `profile_json` JSON NULL COMMENT '非敏感扩展属性；secret 不得落入此字段',
  `last_login_at` DATETIME NULL,
  `last_synced_at` DATETIME NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_directory_identities_provider_subject` (`provider_code`, `provider_subject`),
  UNIQUE KEY `uk_directory_identities_uid_provider` (`uid`, `provider_code`),
  KEY `idx_directory_identities_email` (`email`),
  KEY `idx_directory_identities_status` (`status`, `last_synced_at`),
  CONSTRAINT `fk_directory_identities_user`
    FOREIGN KEY (`uid`) REFERENCES `directory_users` (`uid`)
    ON DELETE CASCADE,
  CONSTRAINT `ck_directory_identities_status`
    CHECK (`status` IN ('active', 'inactive', 'revoked', 'deleted'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 目录同步任务：从 account / LDAP / 企业微信 / 钉钉等源同步到 console.directory_*。
CREATE TABLE IF NOT EXISTS `directory_sync_jobs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `job_code` VARCHAR(128) NOT NULL,
  `provider_code` VARCHAR(64) NOT NULL,
  `integration_id` BIGINT UNSIGNED NULL COMMENT '如通过 console.integration-config 管理目录源，可关联 integrations',
  `sync_type` VARCHAR(32) NOT NULL DEFAULT 'incremental' COMMENT 'full / incremental / manual / shadow_check',
  `object_scope` VARCHAR(64) NOT NULL DEFAULT 'all' COMMENT 'all / users / departments / projects / identities',
  `cursor_before` VARCHAR(500) NULL,
  `cursor_after` VARCHAR(500) NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'pending',
  `started_at` DATETIME NULL,
  `finished_at` DATETIME NULL,
  `requested_by` VARCHAR(128) NULL,
  `total_count` INT NOT NULL DEFAULT 0,
  `created_count` INT NOT NULL DEFAULT 0,
  `updated_count` INT NOT NULL DEFAULT 0,
  `deleted_count` INT NOT NULL DEFAULT 0,
  `skipped_count` INT NOT NULL DEFAULT 0,
  `error_count` INT NOT NULL DEFAULT 0,
  `error_message` VARCHAR(1000) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_directory_sync_jobs_code` (`job_code`),
  KEY `idx_directory_sync_jobs_provider` (`provider_code`, `status`, `started_at`),
  KEY `idx_directory_sync_jobs_status` (`status`, `created_at`),
  KEY `idx_directory_sync_jobs_integration` (`integration_id`),
  CONSTRAINT `fk_directory_sync_jobs_integration`
    FOREIGN KEY (`integration_id`) REFERENCES `integrations` (`id`)
    ON DELETE SET NULL,
  CONSTRAINT `ck_directory_sync_jobs_status`
    CHECK (`status` IN ('pending', 'running', 'success', 'partial_success', 'failed', 'cancelled'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `directory_sync_events` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `job_code` VARCHAR(128) NOT NULL,
  `object_type` VARCHAR(32) NOT NULL COMMENT 'user / department / project / identity / membership',
  `object_code` VARCHAR(255) NOT NULL,
  `change_type` VARCHAR(32) NOT NULL COMMENT 'create / update / delete / skip / error',
  `source_provider` VARCHAR(64) NOT NULL,
  `external_ref` VARCHAR(255) NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'success',
  `message` VARCHAR(1000) NULL,
  `before_hash` VARCHAR(128) NULL,
  `after_hash` VARCHAR(128) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_directory_sync_events_job` (`job_code`, `created_at`),
  KEY `idx_directory_sync_events_object` (`object_type`, `object_code`),
  KEY `idx_directory_sync_events_status` (`status`, `created_at`),
  CONSTRAINT `fk_directory_sync_events_job`
    FOREIGN KEY (`job_code`) REFERENCES `directory_sync_jobs` (`job_code`)
    ON DELETE CASCADE,
  CONSTRAINT `ck_directory_sync_events_status`
    CHECK (`status` IN ('success', 'skipped', 'failed'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Platform subject_sync 只允许读取该最小投影，不读取 directory_users 的姓名、邮箱、手机号等 PII。
CREATE TABLE IF NOT EXISTS `directory_subject_exports` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `subject_type` VARCHAR(32) NOT NULL COMMENT 'user / department / committee / project',
  `subject_code` VARCHAR(128) NOT NULL COMMENT 'uid / dept_code / project_code',
  `external_ref` VARCHAR(255) NULL COMMENT '给 platform 的稳定外部引用，可脱敏或哈希',
  `parent_subject_type` VARCHAR(32) NULL,
  `parent_subject_code` VARCHAR(128) NULL,
  `source_object_type` VARCHAR(32) NOT NULL COMMENT 'directory_users / directory_departments / directory_projects',
  `source_object_code` VARCHAR(128) NOT NULL,
  `snapshot_hash` VARCHAR(128) NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `exported_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_directory_subject_exports_subject` (`subject_type`, `subject_code`),
  KEY `idx_directory_subject_exports_parent` (`parent_subject_type`, `parent_subject_code`),
  KEY `idx_directory_subject_exports_status` (`status`, `exported_at`),
  KEY `idx_directory_subject_exports_source` (`source_object_type`, `source_object_code`),
  CONSTRAINT `ck_directory_subject_exports_type`
    CHECK (`subject_type` IN ('user', 'department', 'committee', 'project')),
  CONSTRAINT `ck_directory_subject_exports_status`
    CHECK (`status` IN ('active', 'inactive', 'deleted'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- Section G: Auth Runtime
-- ============================================================

-- 参照 account.user_sessions，目标由 console 接管本地登录/session。
CREATE TABLE IF NOT EXISTS `local_sessions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `session_id` VARCHAR(128) NOT NULL,
  `uid` VARCHAR(64) NOT NULL,
  `identity_id` BIGINT UNSIGNED NULL,
  `auth_provider` VARCHAR(64) NOT NULL DEFAULT 'local',
  `ip_address` VARCHAR(64) NULL,
  `user_agent` VARCHAR(500) NULL,
  `device_summary` VARCHAR(255) NULL,
  `issued_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `last_seen_at` DATETIME NULL,
  `expires_at` DATETIME NOT NULL,
  `revoked_at` DATETIME NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_local_sessions_session` (`session_id`),
  KEY `idx_local_sessions_uid` (`uid`, `status`, `expires_at`),
  KEY `idx_local_sessions_identity` (`identity_id`),
  KEY `idx_local_sessions_expires` (`status`, `expires_at`),
  CONSTRAINT `fk_local_sessions_user`
    FOREIGN KEY (`uid`) REFERENCES `directory_users` (`uid`)
    ON DELETE CASCADE,
  CONSTRAINT `fk_local_sessions_identity`
    FOREIGN KEY (`identity_id`) REFERENCES `directory_identities` (`id`)
    ON DELETE SET NULL,
  CONSTRAINT `ck_local_sessions_status`
    CHECK (`status` IN ('active', 'expired', 'revoked'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 参照 account.login_logs，但以 auth-runtime 事件建模。
CREATE TABLE IF NOT EXISTS `auth_login_events` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `uid` VARCHAR(64) NULL,
  `identity_id` BIGINT UNSIGNED NULL,
  `target_app` VARCHAR(64) NULL,
  `auth_provider` VARCHAR(64) NOT NULL DEFAULT 'local',
  `login_type` VARCHAR(32) NOT NULL DEFAULT 'sso' COMMENT 'password / sso / oauth / oidc / wecom / dingtalk',
  `login_result` VARCHAR(32) NOT NULL COMMENT 'success / failed',
  `failure_reason` VARCHAR(500) NULL,
  `ip_address` VARCHAR(64) NULL,
  `location` VARCHAR(128) NULL,
  `device_summary` VARCHAR(255) NULL,
  `browser` VARCHAR(128) NULL,
  `os` VARCHAR(128) NULL,
  `session_id` VARCHAR(128) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_auth_login_events_uid_time` (`uid`, `created_at`),
  KEY `idx_auth_login_events_identity` (`identity_id`, `created_at`),
  KEY `idx_auth_login_events_result` (`login_result`, `created_at`),
  KEY `idx_auth_login_events_target` (`target_app`, `created_at`),
  KEY `idx_auth_login_events_session` (`session_id`),
  CONSTRAINT `fk_auth_login_events_user`
    FOREIGN KEY (`uid`) REFERENCES `directory_users` (`uid`)
    ON DELETE SET NULL,
  CONSTRAINT `fk_auth_login_events_identity`
    FOREIGN KEY (`identity_id`) REFERENCES `directory_identities` (`id`)
    ON DELETE SET NULL,
  CONSTRAINT `ck_auth_login_events_result`
    CHECK (`login_result` IN ('success', 'failed'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `auth_identity_providers` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `provider_code` VARCHAR(64) NOT NULL,
  `provider_name` VARCHAR(255) NOT NULL,
  `provider_type` VARCHAR(32) NOT NULL COMMENT 'local / ldap / cas / oidc / wecom / dingtalk',
  `integration_code` VARCHAR(128) NULL,
  `issuer_url` VARCHAR(500) NULL,
  `client_id` VARCHAR(255) NULL,
  `credential_ref` VARCHAR(255) NULL,
  `config_json` JSON NULL,
  `is_default` TINYINT(1) NOT NULL DEFAULT 0,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_auth_identity_providers_code` (`provider_code`),
  KEY `idx_auth_identity_providers_type` (`provider_type`, `status`),
  CONSTRAINT `ck_auth_identity_providers_status`
    CHECK (`status` IN ('active', 'inactive', 'deleted'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `auth_clients` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `client_id` VARCHAR(128) NOT NULL COMMENT 'Default is app_code from Platform bundle applications projection.',
  `client_name` VARCHAR(255) NOT NULL,
  `app_code` VARCHAR(64) NULL,
  `client_type` VARCHAR(32) NOT NULL DEFAULT 'public' COMMENT 'public / confidential',
  `auth_mode` VARCHAR(32) NOT NULL DEFAULT 'oidc',
  `home_url` VARCHAR(500) NULL,
  `logout_url` VARCHAR(500) NULL,
  `icon` VARCHAR(255) NULL,
  `description` VARCHAR(500) NULL,
  `source` VARCHAR(32) NOT NULL DEFAULT 'bundle' COMMENT 'bundle / bundle_test / local',
  `source_hash` VARCHAR(128) NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_auth_clients_client` (`client_id`),
  KEY `idx_auth_clients_app` (`app_code`, `status`),
  CONSTRAINT `ck_auth_clients_type`
    CHECK (`client_type` IN ('public', 'confidential')),
  CONSTRAINT `ck_auth_clients_status`
    CHECK (`status` IN ('active', 'inactive', 'deleted'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `auth_client_redirect_uris` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `client_id` BIGINT UNSIGNED NOT NULL,
  `uri_type` VARCHAR(32) NOT NULL DEFAULT 'redirect' COMMENT 'redirect / post_logout',
  `redirect_uri` VARCHAR(1000) NOT NULL,
  `redirect_uri_hash` CHAR(64)
    GENERATED ALWAYS AS (SHA2(`redirect_uri`, 256)) STORED
    COMMENT 'Avoids overlong utf8mb4 unique indexes on redirect_uri.',
  `source` VARCHAR(32) NOT NULL DEFAULT 'bundle' COMMENT 'bundle / bundle_test / local',
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_auth_client_redirect_uris` (`client_id`, `uri_type`, `redirect_uri_hash`),
  KEY `idx_auth_client_redirect_uris_status` (`status`),
  CONSTRAINT `fk_auth_client_redirect_uris_client`
    FOREIGN KEY (`client_id`) REFERENCES `auth_clients` (`id`)
    ON DELETE CASCADE,
  CONSTRAINT `ck_auth_client_redirect_uris_type`
    CHECK (`uri_type` IN ('redirect', 'post_logout')),
  CONSTRAINT `ck_auth_client_redirect_uris_status`
    CHECK (`status` IN ('active', 'inactive', 'deleted'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `auth_authorization_codes` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code_hash` VARCHAR(128) NOT NULL,
  `client_id` BIGINT UNSIGNED NOT NULL,
  `session_id` BIGINT UNSIGNED NOT NULL,
  `uid` VARCHAR(64) NOT NULL,
  `redirect_uri` VARCHAR(1000) NOT NULL,
  `scope` VARCHAR(500) NOT NULL,
  `state_hash` VARCHAR(128) NULL,
  `nonce_hash` VARCHAR(128) NULL,
  `nonce` VARCHAR(255) NULL COMMENT 'OIDC nonce echoed into the ID token. Not a credential; retained only for short-lived auth code exchange.',
  `code_challenge` VARCHAR(255) NOT NULL,
  `code_challenge_method` VARCHAR(16) NOT NULL DEFAULT 'S256',
  `issued_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expires_at` DATETIME NOT NULL,
  `consumed_at` DATETIME NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_auth_authorization_codes_hash` (`code_hash`),
  KEY `idx_auth_authorization_codes_client` (`client_id`, `status`, `expires_at`),
  KEY `idx_auth_authorization_codes_session` (`session_id`),
  CONSTRAINT `fk_auth_authorization_codes_client`
    FOREIGN KEY (`client_id`) REFERENCES `auth_clients` (`id`)
    ON DELETE CASCADE,
  CONSTRAINT `fk_auth_authorization_codes_session`
    FOREIGN KEY (`session_id`) REFERENCES `local_sessions` (`id`)
    ON DELETE CASCADE,
  CONSTRAINT `fk_auth_authorization_codes_user`
    FOREIGN KEY (`uid`) REFERENCES `directory_users` (`uid`)
    ON DELETE CASCADE,
  CONSTRAINT `ck_auth_authorization_codes_status`
    CHECK (`status` IN ('active', 'consumed', 'expired', 'revoked')),
  CONSTRAINT `ck_auth_authorization_codes_challenge_method`
    CHECK (`code_challenge_method` IN ('S256'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `auth_refresh_tokens` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `token_hash` VARCHAR(128) NOT NULL,
  `token_family` VARCHAR(128) NOT NULL,
  `client_id` BIGINT UNSIGNED NOT NULL,
  `session_id` BIGINT UNSIGNED NOT NULL,
  `uid` VARCHAR(64) NOT NULL,
  `issued_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expires_at` DATETIME NOT NULL,
  `rotated_at` DATETIME NULL,
  `revoked_at` DATETIME NULL,
  `reuse_detected_at` DATETIME NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_auth_refresh_tokens_hash` (`token_hash`),
  KEY `idx_auth_refresh_tokens_family` (`token_family`, `status`),
  KEY `idx_auth_refresh_tokens_session` (`session_id`, `status`),
  KEY `idx_auth_refresh_tokens_client` (`client_id`, `status`),
  CONSTRAINT `fk_auth_refresh_tokens_client`
    FOREIGN KEY (`client_id`) REFERENCES `auth_clients` (`id`)
    ON DELETE CASCADE,
  CONSTRAINT `fk_auth_refresh_tokens_session`
    FOREIGN KEY (`session_id`) REFERENCES `local_sessions` (`id`)
    ON DELETE CASCADE,
  CONSTRAINT `fk_auth_refresh_tokens_user`
    FOREIGN KEY (`uid`) REFERENCES `directory_users` (`uid`)
    ON DELETE CASCADE,
  CONSTRAINT `ck_auth_refresh_tokens_status`
    CHECK (`status` IN ('active', 'rotated', 'revoked', 'expired'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `auth_token_events` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `event_type` VARCHAR(32) NOT NULL COMMENT 'issue / refresh / revoke / reuse_detected / introspect',
  `client_id` VARCHAR(128) NULL,
  `uid` VARCHAR(64) NULL,
  `session_hash` VARCHAR(128) NULL,
  `token_hash` VARCHAR(128) NULL,
  `result` VARCHAR(32) NOT NULL DEFAULT 'success',
  `failure_reason` VARCHAR(500) NULL,
  `ip_address` VARCHAR(64) NULL,
  `user_agent` VARCHAR(500) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_auth_token_events_uid_time` (`uid`, `created_at`),
  KEY `idx_auth_token_events_client_time` (`client_id`, `created_at`),
  KEY `idx_auth_token_events_type_time` (`event_type`, `created_at`),
  CONSTRAINT `ck_auth_token_events_result`
    CHECK (`result` IN ('success', 'failed'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `auth_signing_keys` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `kid` VARCHAR(128) NOT NULL,
  `alg` VARCHAR(32) NOT NULL DEFAULT 'EdDSA',
  `use_type` VARCHAR(32) NOT NULL DEFAULT 'sig',
  `public_jwk_json` JSON NOT NULL,
  `private_key_ref` VARCHAR(255) NULL COMMENT 'Vault, file or external secret reference. Plain private key must not be stored here.',
  `not_before` DATETIME NULL,
  `not_after` DATETIME NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'current',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_auth_signing_keys_kid` (`kid`),
  KEY `idx_auth_signing_keys_status` (`status`, `not_before`, `not_after`),
  CONSTRAINT `ck_auth_signing_keys_status`
    CHECK (`status` IN ('current', 'next', 'retired', 'revoked'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 参照 account.user_heartbeats，用于本地在线状态，不上报 platform 目录明细。
CREATE TABLE IF NOT EXISTS `local_presence_heartbeats` (
  `uid` VARCHAR(64) NOT NULL,
  `source_app` VARCHAR(64) NOT NULL,
  `page_path` VARCHAR(255) NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `last_seen_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`uid`, `source_app`),
  KEY `idx_local_presence_last_seen` (`last_seen_at`),
  KEY `idx_local_presence_status` (`status`),
  CONSTRAINT `fk_local_presence_user`
    FOREIGN KEY (`uid`) REFERENCES `directory_users` (`uid`)
    ON DELETE CASCADE,
  CONSTRAINT `ck_local_presence_status`
    CHECK (`status` IN ('active', 'idle', 'offline'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- Section H: Generic Audit
-- ============================================================

CREATE TABLE IF NOT EXISTS `operation_logs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `domain_code` VARCHAR(64) NOT NULL COMMENT 'tenant_profile / system_settings / integration / vault / service_client / directory / auth_runtime',
  `action` VARCHAR(64) NOT NULL,
  `target_type` VARCHAR(64) NOT NULL,
  `target_key` VARCHAR(128) NULL,
  `actor_type` VARCHAR(32) NOT NULL DEFAULT 'human',
  `actor_id` VARCHAR(128) NULL,
  `request_id` VARCHAR(64) NULL,
  `detail_json` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_operation_logs_domain_time` (`domain_code`, `created_at`),
  KEY `idx_operation_logs_actor_time` (`actor_type`, `actor_id`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
