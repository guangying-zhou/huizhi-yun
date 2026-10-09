-- CANDIDATE ONLY; not executed. @apf_tenant, @apf_deployment, @apf_console_deployment must be approved.
-- Runtime scheduled scopes retain the reviewed six rows in Console-SQL-Seed/Verify-apf18-enterprise-scheduler.sql.
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
SELECT w.client,w.audience,w.semanticScope,
 (SELECT COUNT(*) FROM service_client_grants g JOIN service_clients sc ON sc.id=g.service_client_id
 JOIN service_client_credentials cc ON cc.id=sc.current_credential_id AND cc.service_client_id=sc.id AND cc.status='active'
 WHERE BINARY sc.client_code=BINARY w.client AND sc.app_code=IF(w.client='console.runtime','console','enterprise') AND sc.status='active'
 AND BINARY g.resource_code=BINARY w.resource AND g.action=w.action AND g.status='active'
 AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.audience'))=w.audience
 AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.semanticScope'))=w.semanticScope
 AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.tenantCode'))=@apf_tenant
 AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.deploymentCode'))=w.deployment) AS verified_count_must_equal_1
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
SELECT 'console.runtime' client,@apf_console_deployment deployment,'enterprise' audience,'enterprise:notification-detail' resource,'authorize' action,'enterprise:notification-detail:authorize' semanticScope) w;
-- revoked or malformed pre-existing rows require separate approval; seed never revives/overwrites them.
