SELECT sc.client_code,sc.app_code,g.resource_code,g.action,g.status,
  JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.audience')) AS audience
FROM service_clients sc JOIN service_client_grants g ON g.service_client_id=sc.id
WHERE sc.client_code='aims.runtime' AND g.resource_code='codocs:project-document-access'
ORDER BY g.action;

-- Four rows: both runtime audiences × config view / credential resolve.
SELECT sc.client_code,g.resource_code,g.action,g.status,g.scope_json
FROM service_clients sc JOIN service_client_grants g ON g.service_client_id=sc.id
WHERE sc.client_code='codocs.runtime'
  AND g.resource_code IN ('data-runtime:integration_config','data-runtime:credential_vault','tenant-runtime:integration_config','tenant-runtime:credential_vault')
ORDER BY g.resource_code,g.action;
