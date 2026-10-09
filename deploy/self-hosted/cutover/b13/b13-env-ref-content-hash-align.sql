-- S4 B13 (ONLY if the old secret values cannot be carried over): align the current version of the three existing env_ref
-- runtime secrets to the canonical env_ref content hash.
-- Why: in production these rows carry content_hash = sha256(OLD secret VALUE). data-runtime accepts a row only if the hash
-- matches the value in the Runtime environment or the backend-ref NAME (vault_crypto.go vaultContentHashMatches). When new
-- values are generated for the self-hosted Runtime, the old value hash can never match and every service token request
-- fails with invalid_client (409 console_vault_content_mismatch). Canonical form = sha256_ + sha256(variable name), the
-- same form the Vault API itself writes for env_ref and the one svc.aims.client_secret already uses in production.
-- masked_preview held the first/last 4 characters of the old value; it is replaced by a neutral marker.
-- The executor saves the exact pre-image (content_hash, masked_preview) before this runs and restores it on --rollback.
UPDATE vault_secret_versions v
JOIN vault_secrets s ON s.id = v.secret_id AND s.current_version_id = v.id
SET v.content_hash = CONCAT('sha256_', SHA2(v.backend_secret_ref, 256)),
    s.masked_preview = 'env-ref',
    s.updated_at = UTC_TIMESTAMP()
WHERE s.storage_backend = 'env_ref' AND s.status = 'active' AND v.status = 'active' AND v.encryption_scheme = 'external_ref'
  AND ((s.secret_code = 'svc.aims.runtime.client_secret'     AND v.backend_secret_ref = 'HZY_SERVICE_CLIENT_AIMS_SECRET')
    OR (s.secret_code = 'svc.codocs.runtime.client_secret'   AND v.backend_secret_ref = 'HZY_SERVICE_CLIENT_CODOCS_SECRET')
    OR (s.secret_code = 'svc.workflow.runtime.client_secret' AND v.backend_secret_ref = 'HZY_SERVICE_CLIENT_WORKFLOW_SECRET'));
