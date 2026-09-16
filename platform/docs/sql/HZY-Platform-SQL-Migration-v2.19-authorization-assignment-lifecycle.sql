-- HZY Platform SQL Migration v2.19: authorization assignment lifecycle fields.
-- Adds lifecycle and assignment metadata to direct role assignment tables so
-- policy bundles and authorization snapshots can consistently ignore future,
-- suspended or revoked grants.

DELIMITER //

DROP PROCEDURE IF EXISTS `hzy_platform_v2_19_authorization_assignment_lifecycle`//

CREATE PROCEDURE `hzy_platform_v2_19_authorization_assignment_lifecycle`()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'tenant_subject_roles'
      AND COLUMN_NAME = 'assignment_kind'
  ) THEN
    ALTER TABLE `tenant_subject_roles`
      ADD COLUMN `assignment_kind` VARCHAR(32) NOT NULL DEFAULT 'duty' AFTER `source_type`;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'tenant_subject_roles'
      AND COLUMN_NAME = 'reason'
  ) THEN
    ALTER TABLE `tenant_subject_roles`
      ADD COLUMN `reason` VARCHAR(500) NULL AFTER `source_id`;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'tenant_subject_roles'
      AND COLUMN_NAME = 'approved_by_uid'
  ) THEN
    ALTER TABLE `tenant_subject_roles`
      ADD COLUMN `approved_by_uid` VARCHAR(128) NULL AFTER `granted_by_uid`;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'tenant_subject_roles'
      AND COLUMN_NAME = 'starts_at'
  ) THEN
    ALTER TABLE `tenant_subject_roles`
      ADD COLUMN `starts_at` DATETIME NULL AFTER `granted_at`;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'tenant_subject_roles'
      AND COLUMN_NAME = 'status'
  ) THEN
    ALTER TABLE `tenant_subject_roles`
      ADD COLUMN `status` VARCHAR(32) NOT NULL DEFAULT 'active' AFTER `expired_at`;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'tenant_subject_roles'
      AND INDEX_NAME = 'uk_tenant_subject_roles_id_tenant'
  ) THEN
    ALTER TABLE `tenant_subject_roles`
      ADD UNIQUE KEY `uk_tenant_subject_roles_id_tenant` (`id`, `tenant_code`);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'tenant_subject_roles'
      AND INDEX_NAME = 'idx_tenant_subject_roles_effective'
  ) THEN
    ALTER TABLE `tenant_subject_roles`
      ADD KEY `idx_tenant_subject_roles_effective` (`tenant_code`, `subject_id`, `status`, `starts_at`, `expired_at`);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'tenant_account_roles'
      AND COLUMN_NAME = 'starts_at'
  ) THEN
    ALTER TABLE `tenant_account_roles`
      ADD COLUMN `starts_at` DATETIME NULL AFTER `granted_at`;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'tenant_account_roles'
      AND COLUMN_NAME = 'status'
  ) THEN
    ALTER TABLE `tenant_account_roles`
      ADD COLUMN `status` VARCHAR(32) NOT NULL DEFAULT 'active' AFTER `expired_at`;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'tenant_account_roles'
      AND INDEX_NAME = 'idx_tenant_account_roles_effective'
  ) THEN
    ALTER TABLE `tenant_account_roles`
      ADD KEY `idx_tenant_account_roles_effective` (`tenant_code`, `account_id`, `status`, `starts_at`, `expired_at`);
  END IF;
END//

CALL `hzy_platform_v2_19_authorization_assignment_lifecycle`()//

DROP PROCEDURE IF EXISTS `hzy_platform_v2_19_authorization_assignment_lifecycle`//

DELIMITER ;
