-- CANDIDATE ONLY: reviewed code does not authorize environment execution.
-- Caller must bind @p1_tenant and @p1_enterprise_deployment from registry facts,
-- back up the full grant table encrypted, and verify source/target deployments.
-- NULL parameters insert nothing. Existing rows (including revoked) are untouched.
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
START TRANSACTION;
INSERT INTO service_client_grants(service_client_id,resource_code,action,scope_json,status,created_at,updated_at)
SELECT sc.id,g.resource,g.action,
 JSON_OBJECT('source','candidate:adr018a-p1','audience','codocs','semanticScope',g.semantic_scope,
 'tenantCode',@p1_tenant,'deploymentCode',@p1_enterprise_deployment),
 'active',UTC_TIMESTAMP(),UTC_TIMESTAMP()
FROM service_clients sc CROSS JOIN (
SELECT 'codocs:documents' AS resource, 'write' AS action, 'codocs:documents:write' AS semantic_scope
UNION ALL SELECT 'codocs:product-document' AS resource, 'read' AS action, 'codocs:product-document:read' AS semantic_scope
UNION ALL SELECT 'codocs:product-document' AS resource, 'create' AS action, 'codocs:product-document:create' AS semantic_scope
UNION ALL SELECT 'codocs:project-document' AS resource, 'content:read' AS action, 'codocs:project-document:content:read' AS semantic_scope
UNION ALL SELECT 'codocs:department-documents' AS resource, 'list' AS action, 'codocs:department-documents:list' AS semantic_scope
UNION ALL SELECT 'codocs:project-document' AS resource, 'version:resolve' AS action, 'codocs:project-document:version:resolve' AS semantic_scope
UNION ALL SELECT 'codocs:project-document' AS resource, 'review-content:read' AS action, 'codocs:project-document:review-content:read' AS semantic_scope
UNION ALL SELECT 'codocs:project-document' AS resource, 'review-grant:create' AS action, 'codocs:project-document:review-grant:create' AS semantic_scope
UNION ALL SELECT 'codocs:company-weekly-summary' AS resource, 'publish' AS action, 'codocs:company-weekly-summary:publish' AS semantic_scope
UNION ALL SELECT 'codocs:project-document-access' AS resource, 'read' AS action, 'codocs:project-document-access:read' AS semantic_scope
UNION ALL SELECT 'codocs:project-document-access' AS resource, 'manage' AS action, 'codocs:project-document-access:manage' AS semantic_scope
UNION ALL SELECT 'codocs:project-document-access' AS resource, 'create' AS action, 'codocs:project-document-access:create' AS semantic_scope
UNION ALL SELECT 'codocs:project-cabinet' AS resource, 'read' AS action, 'codocs:project-cabinet:read' AS semantic_scope
UNION ALL SELECT 'codocs:project-cabinet' AS resource, 'upload' AS action, 'codocs:project-cabinet:upload' AS semantic_scope
UNION ALL SELECT 'codocs:project-cabinet' AS resource, 'delete' AS action, 'codocs:project-cabinet:delete' AS semantic_scope
) g
WHERE sc.client_code='enterprise.runtime' AND sc.app_code='enterprise' AND sc.status='active'
 AND @p1_tenant IS NOT NULL AND @p1_enterprise_deployment IS NOT NULL
 AND LENGTH(TRIM(@p1_tenant))>0 AND LENGTH(TRIM(@p1_enterprise_deployment))>0
 AND NOT EXISTS(SELECT 1 FROM service_client_grants old WHERE old.service_client_id=sc.id AND old.resource_code=g.resource AND old.action=g.action);
COMMIT;
