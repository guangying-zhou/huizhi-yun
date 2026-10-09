-- CANDIDATE ONLY: exactly one ACTIVE bound row per pair; any 0/duplicate fails.
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
SELECT p.resource,p.action,COUNT(g.id) matching_active,
 IF(COUNT(g.id)=1,'PASS','FAIL') result
FROM (SELECT 'hr-source-sync' resource,'view' action
 UNION ALL SELECT 'hr-source-sync','admin'
 UNION ALL SELECT 'hr-source-sync','execute') p
LEFT JOIN service_clients sc ON sc.client_code='enterprise.runtime' AND sc.app_code='enterprise' AND sc.status='active'
LEFT JOIN service_client_grants g ON g.service_client_id=sc.id AND BINARY g.resource_code=BINARY CONCAT('console:',p.resource)
 AND BINARY g.action=BINARY p.action AND g.status='active'
 AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.audience'))='console'
 AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.semanticScope'))=CONCAT('console:',p.resource,':',p.action)
 AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.tenantCode'))=@apf_tenant
 AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.deploymentCode'))=@apf_deployment
GROUP BY p.resource,p.action ORDER BY p.resource,p.action;
