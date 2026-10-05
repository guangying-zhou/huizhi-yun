-- G-7 production candidate. Bound values come from the reviewed plan, never hard-coded IDs.
-- Catalog includes aims.runtime -> codocs:company-weekly-summary:publish (aud=codocs)
-- and repairs the existing codocs.runtime -> data-runtime:codocs/write (codocs.write).
-- Six existing codocs.runtime OSS rows are repair-only: no replacement INSERT.
-- Optional collab.runtime -> data-runtime:codocs:collaboration-snapshots read/publish (2 rows).
-- name: service-client
INSERT INTO service_clients(client_code,client_name,client_type,app_code,description,status,created_at,updated_at)
VALUES ('enterprise.runtime','Enterprise Host Runtime','app','enterprise','Customer-held Enterprise Host service identity','active',UTC_TIMESTAMP(),UTC_TIMESTAMP())
-- name: collab-service-client
-- Only when bindings.deployments.collab is set. No credential, secret or hash is
-- created here; the client secret is enrolled through the formal credential flow.
INSERT INTO service_clients(client_code,client_name,client_type,app_code,description,status,created_at,updated_at)
VALUES ('collab.runtime','Collab Runtime','app','collab','Standalone Collab v2 snapshot service identity','active',UTC_TIMESTAMP(),UTC_TIMESTAMP())
-- name: oidc-client
INSERT INTO auth_clients(client_id,client_name,app_code,client_type,auth_mode,source,status,created_at,updated_at)
VALUES ('enterprise','Enterprise','enterprise','public','oidc','local','active',UTC_TIMESTAMP(),UTC_TIMESTAMP())
-- name: grant
INSERT INTO service_client_grants(service_client_id,resource_code,action,scope_json,status,created_at,updated_at)
VALUES (?,?,?,CAST(? AS JSON),'active',UTC_TIMESTAMP(),UTC_TIMESTAMP())
