SELECT sc.app_code, sc.client_code, g.resource_code, g.action, g.status, g.scope_json
FROM service_client_grants g
JOIN service_clients sc ON sc.id=g.service_client_id
WHERE (sc.app_code='altoc' AND g.resource_code='finance:invoice-request' AND g.action='create')
   OR (sc.app_code='finance' AND g.resource_code='workflow:invoice-request' AND g.action='create')
ORDER BY sc.app_code, sc.client_code;

