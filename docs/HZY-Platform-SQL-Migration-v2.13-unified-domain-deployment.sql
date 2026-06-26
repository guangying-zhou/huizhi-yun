-- HZY Platform SQL Migration v2.13: unified-domain deployment site and app base paths.

CREATE TABLE IF NOT EXISTS `deployment_sites` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_code` VARCHAR(64) NOT NULL,
  `site_code` VARCHAR(128) NOT NULL,
  `site_name` VARCHAR(255) NOT NULL,
  `public_url` VARCHAR(512) NOT NULL,
  `root_app_code` VARCHAR(64) NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `active_tenant_code` VARCHAR(64)
    GENERATED ALWAYS AS (
      CASE
        WHEN `status` = 'active' THEN `tenant_code`
        ELSE NULL
      END
    ) STORED COMMENT 'active 站点唯一键',
  `created_by_account_id` BIGINT UNSIGNED NULL COMMENT '跨域→platform_accounts，无 FK',
  `updated_by_account_id` BIGINT UNSIGNED NULL COMMENT '跨域→platform_accounts，无 FK',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_deployment_sites_site_code` (`site_code`),
  UNIQUE KEY `uk_deployment_sites_tenant_site` (`tenant_code`, `site_code`),
  UNIQUE KEY `uk_deployment_sites_active_tenant` (`active_tenant_code`),
  KEY `idx_deployment_sites_tenant_status` (`tenant_code`, `status`),
  CONSTRAINT `fk_deployment_sites_tenant`
    FOREIGN KEY (`tenant_code`) REFERENCES `tenants` (`tenant_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `deployments`
  ADD COLUMN `site_id` BIGINT UNSIGNED NULL AFTER `subscription_id`,
  ADD COLUMN `base_path` VARCHAR(255) NULL AFTER `site_id`,
  ADD COLUMN `api_base` VARCHAR(255) NULL AFTER `base_path`,
  ADD COLUMN `route_source` VARCHAR(32) NOT NULL DEFAULT 'default' AFTER `api_base`,
  ADD COLUMN `active_site_path_key` VARCHAR(320)
    GENERATED ALWAYS AS (
      CASE
        WHEN `status` = 'active' AND `site_id` IS NOT NULL AND `base_path` IS NOT NULL
          THEN CONCAT(`site_id`, ':', `base_path`)
        ELSE NULL
      END
    ) STORED COMMENT '同一 active site 下 base_path 唯一键' AFTER `active_unique_key`,
  ADD UNIQUE KEY `uk_deployments_active_site_path` (`active_site_path_key`),
  ADD KEY `idx_deployments_site_status` (`site_id`, `status`),
  ADD CONSTRAINT `fk_deployments_site`
    FOREIGN KEY (`site_id`) REFERENCES `deployment_sites` (`id`);
