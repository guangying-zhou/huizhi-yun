-- CANDIDATE ONLY. Same three reviewed parameters as seed. Each row must be ready=1.
SELECT d.domain,c.resource,c.action,@apf_audience AS audience,
 COUNT(g.id) AS row_count,
 IF(COUNT(g.id)=1 AND MAX(g.status)='active'
  AND BINARY MAX(JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.tenantCode')))=BINARY @apf_tenant
  AND BINARY MAX(JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.deploymentCode')))=BINARY @apf_deployment
  AND BINARY MAX(JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.audience')))=BINARY @apf_audience
  AND BINARY MAX(JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.semanticScope')))=BINARY CONCAT(d.domain,':',c.resource,':',c.action)
  AND MAX(sc.status)='active' AND MAX(sc.app_code)='enterprise'
  AND MAX(scc.status)='active'
  AND @apf_audience IN ('data-runtime','tenant-runtime'),1,0) AS ready,
 CASE WHEN COUNT(g.id)=0 THEN 'missing'
  WHEN COUNT(g.id)<>1 THEN 'duplicate'
  WHEN MAX(g.status)='revoked' THEN 'revoked_do_not_revive'
  WHEN MAX(g.status)<>'active' THEN 'inactive_do_not_revive'
  ELSE 'verify_binding_and_semantic_scope' END AS diagnostic
FROM (SELECT 'altoc' AS domain UNION ALL SELECT 'people' UNION ALL SELECT 'finance') d
CROSS JOIN (SELECT 'enterprise-host' AS resource,'execute' AS action
 UNION ALL SELECT 'scheduler','execute'
 UNION ALL SELECT 'notification-detail','authorize') c
LEFT JOIN service_clients sc ON sc.client_code='enterprise.runtime' AND sc.app_code='enterprise'
LEFT JOIN service_client_credentials scc ON scc.id=sc.current_credential_id AND scc.service_client_id=sc.id
LEFT JOIN service_client_grants g ON g.service_client_id=sc.id
 AND BINARY g.resource_code=BINARY CONCAT(@apf_audience,':',d.domain,':',c.resource) AND g.action=c.action
GROUP BY d.domain,c.resource,c.action ORDER BY d.domain,c.resource;
