-- HZY Platform Migration v2.4: Drop deployment_signing_keys
-- Date: 2026-04-25
-- Purpose:
-- 1) Align with D-5 boundary: deployment signing keys stay in customer-side console.
-- 2) Platform keeps governance digests only on deployments.

START TRANSACTION;

ALTER TABLE `deployments`
  ADD COLUMN IF NOT EXISTS `current_kid` VARCHAR(64) NULL AFTER `target_release_id`,
  ADD COLUMN IF NOT EXISTS `current_pubkey_fingerprint` VARCHAR(64) NULL COMMENT 'deployment 当前公钥指纹摘要（sha256 前缀）' AFTER `current_kid`,
  ADD COLUMN IF NOT EXISTS `last_kid_reported_at` DATETIME NULL AFTER `current_pubkey_fingerprint`,
  ADD COLUMN IF NOT EXISTS `last_key_rotated_at` DATETIME NULL AFTER `last_kid_reported_at`;

DROP TABLE IF EXISTS `deployment_signing_keys`;

COMMIT;
