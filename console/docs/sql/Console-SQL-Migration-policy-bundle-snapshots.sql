-- Run against the explicitly selected tenant Console database; no USE statement.
-- Verified Platform policy snapshots; accessed only through Data Runtime.
CREATE TABLE IF NOT EXISTS `policy_bundle_snapshots` (
  `tenant_code` varchar(64) COLLATE utf8mb4_bin NOT NULL,
  `deployment_code` varchar(191) COLLATE utf8mb4_bin NOT NULL,
  `object_key` varchar(80) COLLATE utf8mb4_bin NOT NULL,
  `envelope` mediumtext NOT NULL,
  `etag` char(64) COLLATE utf8mb4_bin NOT NULL,
  `synced_at_ms` bigint NOT NULL,
  `bundle_version` varchar(191) NOT NULL,
  `bundle_hash` varchar(191) NOT NULL,
  PRIMARY KEY (`tenant_code`, `deployment_code`, `object_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
