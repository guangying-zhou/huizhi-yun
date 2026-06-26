-- Console migration v1.4: auth authorization code nonce echo
--
-- Purpose:
--   Phase 2 OIDC token exchange needs to echo the request nonce into the ID
--   token. The nonce is not a credential; it is stored only with the short-lived
--   authorization code and remains hash-auditable through nonce_hash.
--
-- Preconditions:
--   1. Run this against the Console database, not the Platform database.
--      Typical dev DB: hzy_console.
--   2. docs/Console-SQL-Migration-v1.3-auth-runtime-core.sql has been applied.

ALTER TABLE `auth_authorization_codes`
  ADD COLUMN `nonce` VARCHAR(255) NULL
    COMMENT 'OIDC nonce echoed into the ID token. Not a credential; retained only for short-lived auth code exchange.'
    AFTER `nonce_hash`;
