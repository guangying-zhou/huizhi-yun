-- S4 B13 (after the G-7 apply): initial env_ref credential for the client `enterprise.runtime`.
-- G-7 creates the client and its grants but never a credential. The secret VALUE is not stored anywhere in the database:
-- the row points at the Runtime process environment variable HZY_SERVICE_CLIENT_ENTERPRISE_SECRET (env_ref backend), exactly
-- like the existing aims/codocs/workflow runtime clients. content_hash uses the canonical env_ref form that the Vault API
-- itself writes (sha256_ + sha256(variable name)), which data-runtime accepts (vault_crypto.go: vaultContentHashMatches
-- matches either the value hash or the backend-ref hash), so the value can change without touching the database.
-- Shape copied column by column from the production codocs.runtime rows. Run by b13-env-ref-credentials.mjs in ONE transaction.
-- Guards (each must hold or the script aborts): the client exists, is active, app_code=enterprise, has no credential, and
-- neither the vault secret code nor any credential for it exists.
SET @client_id = (SELECT id FROM service_clients WHERE client_code='enterprise.runtime' AND app_code='enterprise' AND status='active' AND current_credential_id IS NULL);
SET @guard = (SELECT COUNT(*) FROM vault_secrets WHERE secret_code='svc.enterprise.runtime.client_secret' OR (owner_type='service_client' AND owner_key='enterprise.runtime'))
           + (SELECT COUNT(*) FROM service_client_credentials WHERE service_client_id=@client_id OR client_id='enterprise.runtime');
INSERT INTO vault_secrets (secret_code, secret_ref, secret_name, secret_type, usage_type, owner_type, owner_key, storage_backend,
                           kms_key_ref, current_version_id, reveal_policy, rotate_policy_json, masked_preview, expires_at,
                           last_rotated_at, status, created_by, created_at, updated_at)
SELECT 'svc.enterprise.runtime.client_secret', 'hzybase://vault/svc.enterprise.runtime.client_secret', 'enterprise Runtime Secret',
       'client_secret', 'service', 'service_client', 'enterprise.runtime', 'env_ref',
       NULL, NULL, 'approval', NULL, 'env-ref', NULL, UTC_TIMESTAMP(), 'active', 'system', UTC_TIMESTAMP(), UTC_TIMESTAMP()
FROM DUAL WHERE @client_id IS NOT NULL AND @guard = 0;
SET @secret_id = (SELECT id FROM vault_secrets WHERE secret_code='svc.enterprise.runtime.client_secret');
INSERT INTO vault_secret_versions (secret_id, version_no, ciphertext_blob, backend_secret_ref, content_hash, encryption_scheme,
                                   key_fingerprint, rotated_from_id, status, activated_at, retired_at, created_by, created_at)
SELECT @secret_id, 1, NULL, 'HZY_SERVICE_CLIENT_ENTERPRISE_SECRET', CONCAT('sha256_', SHA2('HZY_SERVICE_CLIENT_ENTERPRISE_SECRET', 256)),
       'external_ref', NULL, NULL, 'active', UTC_TIMESTAMP(), NULL, 'system', UTC_TIMESTAMP()
FROM DUAL WHERE @secret_id IS NOT NULL AND @client_id IS NOT NULL AND @guard = 0;
SET @version_id = (SELECT id FROM vault_secret_versions WHERE secret_id=@secret_id AND version_no=1);
UPDATE vault_secrets SET current_version_id=@version_id WHERE id=@secret_id AND current_version_id IS NULL;
INSERT INTO service_client_credentials (service_client_id, client_id, version_no, secret_id, rotated_from_id, issued_at, expires_at, status)
SELECT @client_id, 'enterprise.runtime', 1, @secret_id, NULL, UTC_TIMESTAMP(), NULL, 'active'
FROM DUAL WHERE @version_id IS NOT NULL AND @client_id IS NOT NULL AND @guard = 0;
SET @credential_id = (SELECT id FROM service_client_credentials WHERE service_client_id=@client_id AND version_no=1);
UPDATE service_clients SET current_credential_id=@credential_id, updated_at=UTC_TIMESTAMP() WHERE id=@client_id AND current_credential_id IS NULL;
