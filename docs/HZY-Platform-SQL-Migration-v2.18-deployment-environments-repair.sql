-- HZY Platform SQL Migration v2.18: repair deployment environment schema.
-- Use this after deploying v2.17 code if a production database either has not
-- run v2.17 yet or v2.17 stopped midway. The procedure only applies missing
-- columns/indexes and safely rebuilds generated unique keys.

DELIMITER //

DROP PROCEDURE IF EXISTS `hzy_platform_v2_18_deployment_env_repair`//

CREATE PROCEDURE `hzy_platform_v2_18_deployment_env_repair`()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'deployment_sites'
      AND COLUMN_NAME = 'environment'
  ) THEN
    ALTER TABLE `deployment_sites`
      ADD COLUMN `environment` VARCHAR(32) NOT NULL DEFAULT 'prod' AFTER `root_app_code`;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'deployment_sites'
      AND INDEX_NAME = 'uk_deployment_sites_active_tenant'
  ) THEN
    ALTER TABLE `deployment_sites` DROP INDEX `uk_deployment_sites_active_tenant`;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'deployment_sites'
      AND INDEX_NAME = 'idx_deployment_sites_tenant_status'
  ) THEN
    ALTER TABLE `deployment_sites` DROP INDEX `idx_deployment_sites_tenant_status`;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'deployment_sites'
      AND COLUMN_NAME = 'active_tenant_code'
  ) THEN
    ALTER TABLE `deployment_sites` DROP COLUMN `active_tenant_code`;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'deployment_sites'
      AND COLUMN_NAME = 'active_tenant_environment_key'
  ) THEN
    ALTER TABLE `deployment_sites`
      ADD COLUMN `active_tenant_environment_key` VARCHAR(160)
        GENERATED ALWAYS AS (
          CASE
            WHEN `status` = 'active' THEN CONCAT(`tenant_code`, ':', `environment`)
            ELSE NULL
          END
        ) STORED COMMENT '同租户同环境 active 站点唯一键' AFTER `status`;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'deployment_sites'
      AND INDEX_NAME = 'uk_deployment_sites_active_tenant_env'
  ) THEN
    ALTER TABLE `deployment_sites`
      ADD UNIQUE KEY `uk_deployment_sites_active_tenant_env` (`active_tenant_environment_key`);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'deployment_sites'
      AND INDEX_NAME = 'idx_deployment_sites_tenant_env_status'
  ) THEN
    ALTER TABLE `deployment_sites`
      ADD KEY `idx_deployment_sites_tenant_env_status` (`tenant_code`, `environment`, `status`);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'deployments'
      AND COLUMN_NAME = 'environment'
  ) THEN
    ALTER TABLE `deployments`
      ADD COLUMN `environment` VARCHAR(32) NOT NULL DEFAULT 'prod' AFTER `deployment_mode`;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'deployments'
      AND INDEX_NAME = 'uk_deployments_tenant_app_active'
  ) THEN
    ALTER TABLE `deployments` DROP INDEX `uk_deployments_tenant_app_active`;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'deployments'
      AND COLUMN_NAME = 'active_unique_key'
  ) THEN
    ALTER TABLE `deployments` DROP COLUMN `active_unique_key`;
  END IF;

  ALTER TABLE `deployments`
    ADD COLUMN `active_unique_key` VARCHAR(160)
      GENERATED ALWAYS AS (
        CASE
          WHEN `status` = 'active' THEN `environment`
          ELSE CONCAT('inactive#', `deployment_code`)
        END
      ) STORED COMMENT '同租户同应用同环境 active 状态唯一键' AFTER `status`;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'deployments'
      AND INDEX_NAME = 'uk_deployments_tenant_app_active'
  ) THEN
    ALTER TABLE `deployments`
      ADD UNIQUE KEY `uk_deployments_tenant_app_active` (`tenant_code`, `app_code`, `active_unique_key`);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'deployments'
      AND INDEX_NAME = 'idx_deployments_tenant_env_status'
  ) THEN
    ALTER TABLE `deployments`
      ADD KEY `idx_deployments_tenant_env_status` (`tenant_code`, `environment`, `status`);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'policy_bundles'
      AND COLUMN_NAME = 'environment'
  ) THEN
    ALTER TABLE `policy_bundles`
      ADD COLUMN `environment` VARCHAR(32) NOT NULL DEFAULT 'prod' AFTER `tenant_code`;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'policy_bundles'
      AND INDEX_NAME = 'idx_policy_bundles_status'
  ) THEN
    ALTER TABLE `policy_bundles` DROP INDEX `idx_policy_bundles_status`;
  END IF;

  ALTER TABLE `policy_bundles`
    ADD KEY `idx_policy_bundles_status` (`tenant_code`, `environment`, `status`);
END//

CALL `hzy_platform_v2_18_deployment_env_repair`()//

DROP PROCEDURE IF EXISTS `hzy_platform_v2_18_deployment_env_repair`//

DELIMITER ;
