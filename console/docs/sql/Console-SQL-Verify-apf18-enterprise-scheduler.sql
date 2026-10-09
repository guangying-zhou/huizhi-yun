-- Must return PASS for all six rows. Existing revoked/conflicting bindings FAIL;
-- seed never revives or updates them. No writes in verify.
SELECT a.audience,d.domain,IF(COUNT(g.id)=1 AND SUM(g.status='active'
 AND BINARY JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.audience'))=BINARY a.audience
 AND BINARY JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.semanticScope'))=BINARY CONCAT(d.domain,':scheduler:execute')
 AND BINARY JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.tenantCode'))=BINARY @apf_tenant
 AND BINARY JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.deploymentCode'))=BINARY @apf_deployment)=1,'PASS','FAIL') result
FROM (SELECT 'data-runtime' audience UNION ALL SELECT 'tenant-runtime') a
CROSS JOIN (SELECT 'altoc' domain UNION ALL SELECT 'finance' UNION ALL SELECT 'people') d
LEFT JOIN service_clients sc ON sc.client_code='enterprise.runtime' AND sc.app_code='enterprise' AND sc.status='active'
LEFT JOIN service_client_credentials cc ON cc.id=sc.current_credential_id AND cc.service_client_id=sc.id AND cc.status='active'
LEFT JOIN service_client_grants g ON g.service_client_id=sc.id AND cc.id IS NOT NULL
 AND BINARY g.resource_code=BINARY CONCAT(a.audience,':',d.domain,':scheduler') AND g.action='execute'
GROUP BY a.audience,d.domain ORDER BY a.audience,d.domain;
