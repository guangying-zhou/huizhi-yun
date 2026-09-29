-- Optional Gateway assertion registry. Additive, no keys or grants seeded.
-- Staff resolves an exact deployment_sites.site_code to site_id; tenant
-- and environment always come from that site, never registration input.
CREATE TABLE IF NOT EXISTS `platform_gateway_keysets` (
  `site_id` BIGINT UNSIGNED NOT NULL,
  `gateway_site_code` VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,
  `tenant_code` VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  `environment` VARCHAR(32) COLLATE utf8mb4_bin NOT NULL,
  `revision` BIGINT UNSIGNED NOT NULL DEFAULT 1,
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`site_id`),
  UNIQUE KEY `uk_gateway_keysets_code` (`gateway_site_code`),
  CONSTRAINT `fk_gateway_keysets_site` FOREIGN KEY (`site_id`) REFERENCES `deployment_sites` (`id`),
  CONSTRAINT `chk_gateway_keysets_revision` CHECK (`revision` > 0),
  CONSTRAINT `chk_gateway_keysets_binding` CHECK (CHAR_LENGTH(`gateway_site_code`) > 0 AND CHAR_LENGTH(`tenant_code`) > 0 AND CHAR_LENGTH(`environment`) > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `platform_gateway_service_keys` (
  `site_id` BIGINT UNSIGNED NOT NULL,
  `kid` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'SHA256 of raw Ed25519 public key',
  `public_key` CHAR(43) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'Canonical base64url of 32 public bytes; no private key',
  `status` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'next',
  `rotation_slot` TINYINT UNSIGNED NOT NULL,
  `live_rotation_slot` TINYINT UNSIGNED GENERATED ALWAYS AS (CASE WHEN `status` IN ('next','active') THEN `rotation_slot` ELSE NULL END) STORED,
  `not_before` BIGINT UNSIGNED NOT NULL COMMENT 'Unix milliseconds',
  `not_after` BIGINT UNSIGNED NOT NULL COMMENT 'Unix milliseconds; at most 90 days after not_before',
  `registered_by` VARCHAR(128) NOT NULL COMMENT 'Authenticated Platform staff uid',
  `registered_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `revoked_at` DATETIME(6) NULL,
  PRIMARY KEY (`site_id`, `kid`),
  UNIQUE KEY `uk_gateway_live_rotation_slot` (`site_id`, `live_rotation_slot`),
  KEY `idx_gateway_keys_validity` (`site_id`, `status`, `not_after`),
  CONSTRAINT `fk_gateway_keys_keyset` FOREIGN KEY (`site_id`) REFERENCES `platform_gateway_keysets` (`site_id`),
  CONSTRAINT `chk_gateway_key_encoding` CHECK (`kid` REGEXP '^[0-9a-f]{64}$' AND `public_key` REGEXP '^[A-Za-z0-9_-]{43}$'),
  CONSTRAINT `chk_gateway_key_status` CHECK (`status` IN ('next','active','revoked')),
  CONSTRAINT `chk_gateway_key_slot` CHECK (`rotation_slot` IN (1,2)),
  CONSTRAINT `chk_gateway_key_validity` CHECK (`not_after` > `not_before` AND `not_after` <= `not_before` + 7776000000),
  CONSTRAINT `chk_gateway_key_revocation` CHECK ((`status` = 'revoked' AND `revoked_at` IS NOT NULL) OR (`status` <> 'revoked' AND `revoked_at` IS NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
