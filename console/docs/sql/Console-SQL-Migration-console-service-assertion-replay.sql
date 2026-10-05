-- One-time use of Console service key assertions (R1,
-- docs/Console-Runtime-Steady-Identity-Proposal-R1-20260922.md). Select the tenant
-- Console database explicitly. Optional like verified_policy_snapshots: before
-- it exists Runtime rejects key assertions with 503 and keeps accepting the
-- Platform bootstrap token. Rows expire within a minute and are purged by Runtime.
CREATE TABLE IF NOT EXISTS `console_service_assertion_replay` (
  `jti` varchar(64) COLLATE utf8mb4_bin NOT NULL,
  `deployment_code` varchar(191) COLLATE utf8mb4_bin NOT NULL,
  `expires_at` bigint NOT NULL,
  PRIMARY KEY (`jti`),
  KEY `idx_console_service_assertion_replay_expires` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
