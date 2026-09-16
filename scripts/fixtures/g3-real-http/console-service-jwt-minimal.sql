-- G3 local-only Console auth fixture schema.
-- Applied only to a fresh temporary hzy_console database by the isolated harness.
CREATE TABLE vault_secrets (
  id BIGINT UNSIGNED PRIMARY KEY,
  secret_code VARCHAR(128) NOT NULL UNIQUE,
  secret_ref VARCHAR(255) NOT NULL UNIQUE,
  secret_name VARCHAR(255) NOT NULL,
  secret_type VARCHAR(32) NOT NULL,
  usage_type VARCHAR(32) NOT NULL,
  owner_type VARCHAR(32) NOT NULL,
  storage_backend VARCHAR(32) NOT NULL,
  current_version_id BIGINT UNSIGNED NULL,
  reveal_policy VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE vault_secret_versions (
  id BIGINT UNSIGNED PRIMARY KEY,
  secret_id BIGINT UNSIGNED NOT NULL,
  version_no INT NOT NULL,
  ciphertext_blob LONGBLOB NULL,
  backend_secret_ref VARCHAR(255) NULL,
  content_hash VARCHAR(128) NOT NULL,
  encryption_scheme VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL,
  UNIQUE KEY uk_g3_secret_version (secret_id, version_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE vault_access_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  secret_id BIGINT UNSIGNED NOT NULL,
  version_id BIGINT UNSIGNED NULL,
  action VARCHAR(32) NOT NULL,
  actor_type VARCHAR(32) NOT NULL,
  actor_id VARCHAR(128) NOT NULL,
  app_code VARCHAR(64) NULL,
  reason VARCHAR(500) NULL,
  result_status VARCHAR(32) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE service_clients (
  id BIGINT UNSIGNED PRIMARY KEY,
  client_code VARCHAR(128) NOT NULL UNIQUE,
  client_name VARCHAR(255) NOT NULL,
  client_type VARCHAR(32) NOT NULL,
  app_code VARCHAR(64) NULL,
  current_credential_id BIGINT UNSIGNED NULL,
  status VARCHAR(32) NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE service_client_credentials (
  id BIGINT UNSIGNED PRIMARY KEY,
  service_client_id BIGINT UNSIGNED NOT NULL,
  client_id VARCHAR(128) NOT NULL UNIQUE,
  version_no INT NOT NULL,
  secret_id BIGINT UNSIGNED NOT NULL,
  rotated_from_id BIGINT UNSIGNED NULL,
  issued_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NULL,
  last_used_at DATETIME NULL,
  status VARCHAR(32) NOT NULL,
  UNIQUE KEY uk_g3_client_version (service_client_id, version_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE service_client_grants (
  id BIGINT UNSIGNED PRIMARY KEY,
  service_client_id BIGINT UNSIGNED NOT NULL,
  resource_code VARCHAR(128) NOT NULL,
  action VARCHAR(32) NOT NULL,
  scope_json JSON NULL,
  status VARCHAR(32) NOT NULL,
  UNIQUE KEY uk_g3_client_grant (service_client_id, resource_code, action)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE auth_signing_keys (
  id BIGINT UNSIGNED PRIMARY KEY,
  kid VARCHAR(128) NOT NULL UNIQUE,
  alg VARCHAR(32) NOT NULL,
  use_type VARCHAR(32) NOT NULL,
  public_jwk_json JSON NOT NULL,
  private_key_ref VARCHAR(255) NULL,
  not_before DATETIME NULL,
  not_after DATETIME NULL,
  status VARCHAR(32) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE auth_token_events (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  event_type VARCHAR(32) NOT NULL,
  client_id VARCHAR(128) NULL,
  uid VARCHAR(64) NULL,
  session_hash VARCHAR(128) NULL,
  token_hash VARCHAR(128) NULL,
  result VARCHAR(32) NOT NULL,
  failure_reason VARCHAR(500) NULL,
  ip_address VARCHAR(64) NULL,
  user_agent VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE org_profiles (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  singleton_key TINYINT UNSIGNED NOT NULL,
  tenant_code VARCHAR(128) NOT NULL,
  org_name VARCHAR(255) NOT NULL,
  org_short_name VARCHAR(255) NULL,
  display_name VARCHAR(255) NULL,
  legal_name VARCHAR(255) NULL,
  unified_social_credit_code VARCHAR(64) NULL,
  logo_path VARCHAR(1024) NULL,
  website_url VARCHAR(1024) NULL,
  industry_code VARCHAR(128) NULL,
  country_code VARCHAR(16) NULL,
  timezone VARCHAR(64) NULL,
  locale VARCHAR(32) NULL,
  currency_code VARCHAR(16) NULL,
  contact_name VARCHAR(255) NULL,
  contact_email VARCHAR(255) NULL,
  contact_mobile VARCHAR(64) NULL,
  address_text VARCHAR(1024) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_org_profiles_singleton (singleton_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
