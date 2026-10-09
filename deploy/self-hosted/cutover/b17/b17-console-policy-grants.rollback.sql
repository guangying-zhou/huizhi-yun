-- Rollback of b17-console-policy-grants.sql: removes exactly the rows it inserted (identified by scope_json.source).
DELETE g FROM service_client_grants g JOIN service_clients c ON c.id=g.service_client_id
WHERE c.client_code='console.runtime' AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.source'))='s4-b17-console-policy';
