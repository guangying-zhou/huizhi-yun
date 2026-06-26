-- HZY Platform SQL Migration v2.17: deployment environments.
-- Allows one tenant to keep separate prod/test deployment sites, deployments,
-- OIDC settings, and policy bundles while sharing tenant data.

ALTER TABLE `deployment_sites`
  ADD COLUMN `environment` VARCHAR(32) NOT NULL DEFAULT 'prod' AFTER `root_app_code`;

ALTER TABLE `deployment_sites`
  DROP INDEX `uk_deployment_sites_active_tenant`,
  DROP INDEX `idx_deployment_sites_tenant_status`;

ALTER TABLE `deployment_sites`
  DROP COLUMN `active_tenant_code`;

ALTER TABLE `deployment_sites`
  ADD COLUMN `active_tenant_environment_key` VARCHAR(160)
    GENERATED ALWAYS AS (
      CASE
        WHEN `status` = 'active' THEN CONCAT(`tenant_code`, ':', `environment`)
        ELSE NULL
      END
    ) STORED COMMENT '同租户同环境 active 站点唯一键' AFTER `status`,
  ADD UNIQUE KEY `uk_deployment_sites_active_tenant_env` (`active_tenant_environment_key`),
  ADD KEY `idx_deployment_sites_tenant_env_status` (`tenant_code`, `environment`, `status`);

ALTER TABLE `deployments`
  ADD COLUMN `environment` VARCHAR(32) NOT NULL DEFAULT 'prod' AFTER `deployment_mode`;

ALTER TABLE `deployments`
  DROP INDEX `uk_deployments_tenant_app_active`;

ALTER TABLE `deployments`
  DROP COLUMN `active_unique_key`;

ALTER TABLE `deployments`
  ADD COLUMN `active_unique_key` VARCHAR(160)
    GENERATED ALWAYS AS (
      CASE
        WHEN `status` = 'active' THEN `environment`
        ELSE CONCAT('inactive#', `deployment_code`)
      END
    ) STORED COMMENT '同租户同应用同环境 active 状态唯一键' AFTER `status`,
  ADD UNIQUE KEY `uk_deployments_tenant_app_active` (`tenant_code`, `app_code`, `active_unique_key`),
  ADD KEY `idx_deployments_tenant_env_status` (`tenant_code`, `environment`, `status`);

ALTER TABLE `policy_bundles`
  ADD COLUMN `environment` VARCHAR(32) NOT NULL DEFAULT 'prod' AFTER `tenant_code`;

ALTER TABLE `policy_bundles`
  DROP INDEX `idx_policy_bundles_status`,
  ADD KEY `idx_policy_bundles_status` (`tenant_code`, `environment`, `status`);
