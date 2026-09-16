-- HZY Platform migration v2.9: role authorization policy fingerprints
--
-- Purpose:
--   Persist compact hashes for system role defaults and tenant role effective
--   permissions/scopes, so dashboard lists can show whether authorization has
--   changed without running a full diff on every card.

START TRANSACTION;

ALTER TABLE `platform_system_roles`
  ADD COLUMN IF NOT EXISTS `policy_revision` BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER `status`,
  ADD COLUMN IF NOT EXISTS `policy_hash` VARCHAR(96) NULL AFTER `policy_revision`,
  ADD COLUMN IF NOT EXISTS `policy_updated_at` DATETIME NULL AFTER `policy_hash`;

ALTER TABLE `tenant_roles`
  ADD COLUMN IF NOT EXISTS `source_policy_hash` VARCHAR(96) NULL AFTER `source_manifest_id`,
  ADD COLUMN IF NOT EXISTS `effective_policy_hash` VARCHAR(96) NULL AFTER `source_policy_hash`,
  ADD COLUMN IF NOT EXISTS `policy_revision` BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER `effective_policy_hash`,
  ADD COLUMN IF NOT EXISTS `policy_updated_at` DATETIME NULL AFTER `policy_revision`;

COMMIT;

-- Backfill note:
--   Hash values are computed by platform/server/utils/rolePolicyHash.ts.
--   They will be populated by role save/sync flows. Existing rows can be
--   refreshed by re-saving system role permissions/scopes or re-enabling the
--   corresponding dashboard roles.
