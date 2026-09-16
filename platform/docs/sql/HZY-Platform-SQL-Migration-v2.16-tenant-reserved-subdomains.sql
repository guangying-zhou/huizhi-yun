-- HZY Platform SQL Migration v2.16: tenant reserved subdomains.
-- These labels cannot be registered as tenant subdomains under the platform
-- tenant domain suffix because they are application prefixes, platform
-- control-plane names, or infrastructure/service hostnames.

CREATE TABLE IF NOT EXISTS `tenant_reserved_subdomains` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `subdomain` VARCHAR(63) NOT NULL,
  `category` VARCHAR(64) NOT NULL DEFAULT 'reserved',
  `description` VARCHAR(255) NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_reserved_subdomains_subdomain` (`subdomain`),
  KEY `idx_tenant_reserved_subdomains_status` (`status`, `category`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `tenant_reserved_subdomains` (`subdomain`, `category`, `description`, `status`)
VALUES
  ('aims', 'application_prefix', 'Application prefix', 'active'),
  ('align', 'application_prefix', 'Application prefix', 'active'),
  ('altoc', 'application_prefix', 'Application prefix', 'active'),
  ('assets', 'application_prefix', 'Application prefix', 'active'),
  ('codocs', 'application_prefix', 'Application prefix', 'active'),
  ('collab', 'application_prefix', 'Collaboration service prefix', 'active'),
  ('finance', 'application_prefix', 'Application prefix', 'active'),
  ('hrm', 'application_prefix', 'Application prefix', 'active'),
  ('insights', 'application_prefix', 'Application prefix', 'active'),
  ('workflow', 'application_prefix', 'Application prefix', 'active'),
  ('admin', 'platform_reserved', 'Platform control-plane hostname', 'active'),
  ('api', 'platform_reserved', 'API hostname', 'active'),
  ('app', 'platform_reserved', 'Application hostname', 'active'),
  ('apps', 'platform_reserved', 'Application hostname', 'active'),
  ('auth', 'platform_reserved', 'Authentication hostname', 'active'),
  ('billing', 'platform_reserved', 'Billing hostname', 'active'),
  ('console', 'platform_reserved', 'Console hostname', 'active'),
  ('dashboard', 'platform_reserved', 'Dashboard hostname', 'active'),
  ('docs', 'platform_reserved', 'Documentation hostname', 'active'),
  ('help', 'platform_reserved', 'Help hostname', 'active'),
  ('id', 'platform_reserved', 'Identity hostname', 'active'),
  ('login', 'platform_reserved', 'Login hostname', 'active'),
  ('oauth', 'platform_reserved', 'OAuth hostname', 'active'),
  ('observability', 'platform_reserved', 'Observability hostname', 'active'),
  ('platform', 'platform_reserved', 'Platform hostname', 'active'),
  ('rum', 'platform_reserved', 'RUM hostname', 'active'),
  ('sso', 'platform_reserved', 'SSO hostname', 'active'),
  ('status', 'platform_reserved', 'Status hostname', 'active'),
  ('support', 'platform_reserved', 'Support hostname', 'active'),
  ('www', 'platform_reserved', 'WWW hostname', 'active'),
  ('cdn', 'infrastructure_reserved', 'CDN hostname', 'active'),
  ('cdn-cgi', 'infrastructure_reserved', 'Cloudflare reserved path/hostname label', 'active'),
  ('dev', 'infrastructure_reserved', 'Development hostname', 'active'),
  ('downloads', 'infrastructure_reserved', 'Downloads hostname', 'active'),
  ('mail', 'infrastructure_reserved', 'Mail hostname', 'active'),
  ('root', 'infrastructure_reserved', 'Root hostname alias', 'active'),
  ('static', 'infrastructure_reserved', 'Static asset hostname', 'active'),
  ('staging', 'infrastructure_reserved', 'Staging hostname', 'active'),
  ('test', 'infrastructure_reserved', 'Test hostname', 'active')
ON DUPLICATE KEY UPDATE
  `category` = VALUES(`category`),
  `description` = VALUES(`description`),
  `status` = 'active',
  `updated_at` = UTC_TIMESTAMP();
