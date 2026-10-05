-- Optional Runtime-only replay storage. Not part of the legacy schema gate.
-- Apply to the registered Console database explicitly; no identity/grant rows.
-- Exchange will insert this row in the SAME transaction as issuance + audit.
CREATE TABLE IF NOT EXISTS `gateway_service_assertion_replay` (
  `gateway_deployment_code` VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,
  `jti` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `tenant_code` VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  `environment` VARCHAR(32) COLLATE utf8mb4_bin NOT NULL,
  `kid` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `expires_at` BIGINT UNSIGNED NOT NULL COMMENT 'Unix milliseconds',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`gateway_deployment_code`, `jti`),
  KEY `idx_gateway_assertion_replay_expires` (`expires_at`),
  CONSTRAINT `chk_gateway_replay_jti` CHECK (`jti` REGEXP '^[A-Za-z0-9_-]{22,64}$'),
  CONSTRAINT `chk_gateway_replay_kid` CHECK (`kid` REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT `chk_gateway_replay_expiry` CHECK (`expires_at` > 0),
  CONSTRAINT `chk_gateway_replay_binding` CHECK (CHAR_LENGTH(`gateway_deployment_code`) > 0 AND CHAR_LENGTH(`tenant_code`) > 0 AND CHAR_LENGTH(`environment`) > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
