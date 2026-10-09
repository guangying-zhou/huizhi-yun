-- CANDIDATE ONLY: reviewed code does not authorize environment execution.
-- Caller must bind @p1_tenant and @p1_enterprise_deployment from registry facts,
-- back up the full grant table encrypted, and verify source/target deployments.
-- NULL parameters insert nothing. Existing rows (including revoked) are untouched.
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
-- Every row must have exact_active=1; missing/revoked/conflicting rows fail review.
SELECT e.semantic_scope,COUNT(g.id) AS present, SUM(g.status='revoked') AS revoked_requires_separate_approval,
 SUM(g.status='active' AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.audience'))='codocs'
 AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.semanticScope'))=e.semantic_scope
 AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.tenantCode'))=@p1_tenant
 AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.deploymentCode'))=@p1_enterprise_deployment) AS exact_active
FROM (
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
) e
LEFT JOIN service_clients sc ON sc.client_code='enterprise.runtime' AND sc.app_code='enterprise' AND sc.status='active'
LEFT JOIN service_client_grants g ON g.service_client_id=sc.id AND g.resource_code=e.resource AND g.action=e.action
GROUP BY e.semantic_scope ORDER BY e.semantic_scope;
