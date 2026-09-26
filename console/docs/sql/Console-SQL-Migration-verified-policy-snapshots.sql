-- Opt-in v1 full-envelope store. Select the tenant Console database explicitly.
-- Do not copy legacy opaque HMAC rows. Expired rows retain rollback watermarks.
CREATE TABLE IF NOT EXISTS `verified_policy_snapshots` (
  `tenant_code` varchar(191) COLLATE utf8mb4_bin NOT NULL,
  `environment` varchar(8) COLLATE utf8mb4_bin NOT NULL,
  `deployment_code` varchar(191) COLLATE utf8mb4_bin NOT NULL,
  `snapshot` mediumtext NULL,
  PRIMARY KEY (`tenant_code`, `environment`, `deployment_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
