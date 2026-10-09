-- Candidate only. Set @feedback_tenant, @feedback_console_deployment and
-- @feedback_enterprise_deployment explicitly before running. Never revive rows.
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
START TRANSACTION;
INSERT INTO service_client_grants(service_client_id,resource_code,action,scope_json,status,created_at,updated_at)
SELECT sc.id,CONCAT(a.audience,':console:',s.resource_code),s.action,
 JSON_OBJECT('source','seed:v2.41','tenantCode',@feedback_tenant,
  'deploymentCode',IF(s.client_code='console.runtime',@feedback_console_deployment,@feedback_enterprise_deployment),
  'audience',a.audience,'semanticScope',CONCAT('console:',s.resource_code,':',s.action)),
 'active',UTC_TIMESTAMP(),UTC_TIMESTAMP()
FROM service_clients sc
JOIN service_client_credentials c ON c.id=sc.current_credential_id AND c.status='active'
CROSS JOIN (SELECT 'data-runtime' AS audience UNION ALL SELECT 'tenant-runtime') a
JOIN (
 SELECT 'console.runtime' AS client_code,'feedback' AS resource_code,'view' AS action
 UNION ALL SELECT 'console.runtime','feedback','retry'
 UNION ALL SELECT 'console.runtime','feedback','admin'
 UNION ALL SELECT 'console.runtime','feedback-settings','view'
 UNION ALL SELECT 'console.runtime','feedback-settings','edit'
 UNION ALL SELECT 'console.runtime','feedback-delivery','execute'
 UNION ALL SELECT 'enterprise.runtime','enterprise-host','execute'
) s ON BINARY sc.client_code=BINARY s.client_code
WHERE sc.status='active' AND BINARY sc.app_code=BINARY IF(s.client_code='console.runtime','console','enterprise')
 AND NULLIF(@feedback_tenant,'') IS NOT NULL
 AND NULLIF(@feedback_console_deployment,'') IS NOT NULL
 AND NULLIF(@feedback_enterprise_deployment,'') IS NOT NULL
 AND NOT EXISTS (
  SELECT 1 FROM service_client_grants g WHERE g.service_client_id=sc.id
  AND BINARY g.resource_code=BINARY CONCAT(a.audience,':console:',s.resource_code) AND BINARY g.action=BINARY s.action
 );
COMMIT;
