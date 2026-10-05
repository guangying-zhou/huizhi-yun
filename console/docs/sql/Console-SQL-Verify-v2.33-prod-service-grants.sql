-- The plan tool verifies all grant columns and the exact audience/semanticScope cardinality,
-- including the two company-summary delivery hops and six Codocs OSS binds.
-- name: all-grants
SELECT g.*,sc.client_code,sc.app_code FROM service_client_grants g
JOIN service_clients sc ON sc.id=g.service_client_id ORDER BY g.id
-- name: clients
SELECT * FROM service_clients ORDER BY id
-- name: oidc-clients
SELECT * FROM auth_clients ORDER BY id
