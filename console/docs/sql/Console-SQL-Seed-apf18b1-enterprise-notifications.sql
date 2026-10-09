-- CANDIDATE ONLY; not executed. @apf_tenant, @apf_deployment, @apf_console_deployment must be approved.
-- Runtime scheduled scopes retain the reviewed six rows in Console-SQL-Seed/Verify-apf18-enterprise-scheduler.sql.
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
START TRANSACTION;
INSERT INTO service_client_grants(service_client_id,resource_code,action,scope_json,status,created_at,updated_at)
SELECT sc.id,w.resource,w.action,JSON_OBJECT('source','seed:apf18b1','audience',w.audience,'semanticScope',w.semanticScope,'tenantCode',@apf_tenant,'deploymentCode',w.deployment),'active',UTC_TIMESTAMP(),UTC_TIMESTAMP()
FROM (SELECT 'enterprise.runtime' client,@apf_deployment deployment,'data-runtime' audience,'data-runtime:altoc:notification-detail' resource,'authorize' action,'altoc:notification-detail:authorize' semanticScope
UNION ALL
SELECT 'enterprise.runtime' client,@apf_deployment deployment,'tenant-runtime' audience,'tenant-runtime:altoc:notification-detail' resource,'authorize' action,'altoc:notification-detail:authorize' semanticScope
UNION ALL
SELECT 'enterprise.runtime' client,@apf_deployment deployment,'data-runtime' audience,'data-runtime:finance:notification-detail' resource,'authorize' action,'finance:notification-detail:authorize' semanticScope
UNION ALL
SELECT 'enterprise.runtime' client,@apf_deployment deployment,'tenant-runtime' audience,'tenant-runtime:finance:notification-detail' resource,'authorize' action,'finance:notification-detail:authorize' semanticScope
UNION ALL
SELECT 'enterprise.runtime' client,@apf_deployment deployment,'data-runtime' audience,'data-runtime:people:notification-detail' resource,'authorize' action,'people:notification-detail:authorize' semanticScope
UNION ALL
SELECT 'enterprise.runtime' client,@apf_deployment deployment,'tenant-runtime' audience,'tenant-runtime:people:notification-detail' resource,'authorize' action,'people:notification-detail:authorize' semanticScope
UNION ALL
SELECT 'enterprise.runtime' client,@apf_deployment deployment,'notifications' audience,'notifications' resource,'publish' action,'notifications:publish' semanticScope
UNION ALL
SELECT 'enterprise.runtime' client,@apf_deployment deployment,'console' audience,'console:authorization' resource,'subject-eligibility' action,'console:authorization:subject-eligibility' semanticScope
UNION ALL
SELECT 'console.runtime' client,@apf_console_deployment deployment,'enterprise' audience,'enterprise:notification-detail' resource,'authorize' action,'enterprise:notification-detail:authorize' semanticScope) w
JOIN service_clients sc ON BINARY sc.client_code=BINARY w.client AND sc.app_code=IF(w.client='console.runtime','console','enterprise') AND sc.status='active'
JOIN service_client_credentials cc ON cc.id=sc.current_credential_id AND cc.service_client_id=sc.id AND cc.status='active'
WHERE @apf_tenant REGEXP '^[A-Za-z0-9_-]{1,64}$' AND w.deployment REGEXP '^[A-Za-z0-9_-]{1,100}$'
AND NOT EXISTS(SELECT 1 FROM service_client_grants old WHERE old.service_client_id=sc.id AND BINARY old.resource_code=BINARY w.resource AND old.action=w.action);
COMMIT;
