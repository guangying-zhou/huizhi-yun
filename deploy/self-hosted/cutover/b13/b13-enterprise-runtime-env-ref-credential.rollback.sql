-- Rollback of b13-enterprise-runtime-env-ref-credential.sql. Removes ONLY what the forward SQL wrote for enterprise.runtime,
-- and only if nothing else references it (no vault_access_logs beyond what the forward run made are deleted blindly: they are
-- removed by secret id first so the foreign keys allow the deletes).
SET @client_id = (SELECT id FROM service_clients WHERE client_code='enterprise.runtime' AND app_code='enterprise');
SET @secret_id = (SELECT id FROM vault_secrets WHERE secret_code='svc.enterprise.runtime.client_secret' AND owner_type='service_client' AND owner_key='enterprise.runtime' AND storage_backend='env_ref');
UPDATE service_clients SET current_credential_id=NULL, updated_at=UTC_TIMESTAMP()
 WHERE id=@client_id AND current_credential_id=(SELECT id FROM service_client_credentials WHERE service_client_id=@client_id AND version_no=1 AND secret_id=@secret_id);
DELETE FROM service_client_credentials WHERE service_client_id=@client_id AND version_no=1 AND secret_id=@secret_id;
UPDATE vault_secrets SET current_version_id=NULL WHERE id=@secret_id;
DELETE FROM vault_access_logs WHERE secret_id=@secret_id;
DELETE FROM vault_secret_versions WHERE secret_id=@secret_id AND version_no=1;
DELETE FROM vault_secrets WHERE id=@secret_id;
