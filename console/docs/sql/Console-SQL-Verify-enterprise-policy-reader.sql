-- Expected: three active read rows (business capability plus two transport
-- audience mappings), zero active writers. Also probe real token
-- issuance for BOTH Runtime audiences and wrong-binding/withdrawn-grant cases.
SELECT c.client_code,g.resource_code,g.action,g.status,
  JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.audience')) audience,
  JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.semanticScope')) semantic_scope FROM service_clients c
JOIN service_client_grants g ON g.service_client_id=c.id
WHERE c.client_code='enterprise.runtime' AND c.app_code='enterprise'
  AND g.resource_code IN ('console:policy-bundle','data-runtime:console:policy-bundle','tenant-runtime:console:policy-bundle');
