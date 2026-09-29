-- CANDIDATE ONLY. Requires helper-created temporary target and scope tables.
-- target_revoked must equal the reviewed count; legacy_active must be zero;
-- domain_total and domain_active must each be five. All other rows, including
-- optional scheduler grants, are checked by the helper's full-table hash.
SELECT 'target_revoked' AS section, COUNT(*) AS observed
FROM v228_targets t JOIN service_client_grants g ON g.id=t.id
WHERE g.status='revoked'
UNION ALL
SELECT 'legacy_active', COUNT(*)
FROM service_client_grants g JOIN service_clients sc ON sc.id=g.service_client_id
JOIN v228_scopes s ON s.semantic_scope=JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.semanticScope'))
WHERE sc.client_code='enterprise.runtime' AND sc.app_code='enterprise' AND g.status='active'
 AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.audience')) IN ('data-runtime','tenant-runtime')
 AND g.action=SUBSTRING_INDEX(s.semantic_scope,':',-1)
 AND g.resource_code IN (
  SUBSTRING_INDEX(s.semantic_scope,':',2),
  CONCAT(JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.audience')),':',SUBSTRING_INDEX(s.semantic_scope,':',2)))
UNION ALL
SELECT 'domain_total', COUNT(*)
FROM service_client_grants g JOIN service_clients sc ON sc.id=g.service_client_id
WHERE sc.client_code='enterprise.runtime' AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.source'))='seed:v2.27'
  AND g.action='execute' AND g.resource_code IN ('data-runtime:aims:enterprise-host','data-runtime:assets:enterprise-host',
   'data-runtime:codocs:enterprise-host','data-runtime:altoc:enterprise-host','data-runtime:console:enterprise-host')
UNION ALL
SELECT 'domain_active', COUNT(*)
FROM service_client_grants g JOIN service_clients sc ON sc.id=g.service_client_id
WHERE sc.client_code='enterprise.runtime' AND g.status='active'
 AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.source'))='seed:v2.27'
 AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.audience'))='data-runtime'
 AND g.action='execute' AND g.resource_code IN ('data-runtime:aims:enterprise-host','data-runtime:assets:enterprise-host',
   'data-runtime:codocs:enterprise-host','data-runtime:altoc:enterprise-host','data-runtime:console:enterprise-host');
