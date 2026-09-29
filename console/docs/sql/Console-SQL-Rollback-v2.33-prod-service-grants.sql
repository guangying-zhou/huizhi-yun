-- Rollback requires the apply receipt and refuses drift or a newly issued credential.
-- This also covers the reviewed Aims -> Codocs and Codocs -> Runtime rows.
-- The six existing Codocs OSS rows restore their entire original scope JSON.
-- name: remove-grant
DELETE FROM service_client_grants WHERE id=?
-- name: restore-grant
UPDATE service_client_grants SET service_client_id=?,resource_code=?,action=?,scope_json=?,status=?,created_at=?,updated_at=? WHERE id=?
-- name: remove-service-client
DELETE FROM service_clients WHERE id=? AND client_code='enterprise.runtime' AND current_credential_id IS NULL
-- name: remove-collab-service-client
DELETE FROM service_clients WHERE id=? AND client_code='collab.runtime' AND current_credential_id IS NULL
-- name: remove-oidc-client
DELETE FROM auth_clients WHERE id=? AND client_id='enterprise'
