-- Prepare only. Expect exactly one row and every *_ok = 1.
SELECT COUNT(*) AS row_count,
  SUM(sc.status='active' AND sc.client_type='runtime'
    AND sc.current_credential_id IS NOT NULL) AS client_ok,
  SUM(g.status='active') AS grant_ok,
  SUM(JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.source'))
    ='seed:cpu-p1-service-token-exchange') AS source_ok,
  SUM(JSON_CONTAINS(JSON_EXTRACT(g.scope_json,'$.audiences'),JSON_QUOTE('data-runtime'))=1)
    AS data_runtime_audience_ok,
  SUM(JSON_CONTAINS(JSON_EXTRACT(g.scope_json,'$.audiences'),JSON_QUOTE('tenant-runtime'))=1)
    AS tenant_runtime_audience_ok
FROM service_client_grants g
JOIN service_clients sc ON sc.id=g.service_client_id
WHERE sc.client_code='console.runtime' AND sc.app_code='console'
  AND g.resource_code='console:service-token' AND g.action='exchange';
-- After applying, also probe real token issuance for both Runtime audiences.
