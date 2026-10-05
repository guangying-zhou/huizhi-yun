-- Run only after the new directory-self route and both grants are active,
-- Host traffic has switched, and the exact before snapshot is reviewed.
-- C000001 only. A grant-table backup is required before this UPDATE.
START TRANSACTION;
UPDATE service_client_grants old_grant
JOIN service_clients c ON c.id = old_grant.service_client_id
JOIN service_client_grants new_data ON new_data.service_client_id = c.id
  AND new_data.resource_code = 'console:directory-self' AND new_data.action = 'read' AND new_data.status = 'active'
  AND JSON_UNQUOTE(JSON_EXTRACT(new_data.scope_json, '$.semanticScope')) = 'console:directory-self:read'
  AND JSON_UNQUOTE(JSON_EXTRACT(new_data.scope_json, '$.tenantCode')) = 'C000001'
  AND JSON_UNQUOTE(JSON_EXTRACT(new_data.scope_json, '$.deploymentCode')) = 'C000001-test-enterprise'
  AND JSON_UNQUOTE(JSON_EXTRACT(new_data.scope_json, '$.audience')) = 'data-runtime'
JOIN service_client_grants new_tenant ON new_tenant.service_client_id = c.id
  AND new_tenant.resource_code = 'tenant-runtime:console:directory-self' AND new_tenant.action = 'read' AND new_tenant.status = 'active'
  AND JSON_UNQUOTE(JSON_EXTRACT(new_tenant.scope_json, '$.semanticScope')) = 'console:directory-self:read'
  AND JSON_UNQUOTE(JSON_EXTRACT(new_tenant.scope_json, '$.tenantCode')) = 'C000001'
  AND JSON_UNQUOTE(JSON_EXTRACT(new_tenant.scope_json, '$.deploymentCode')) = 'C000001-test-enterprise'
  AND JSON_UNQUOTE(JSON_EXTRACT(new_tenant.scope_json, '$.audience')) = 'tenant-runtime'
SET old_grant.status = 'inactive', old_grant.updated_at = UTC_TIMESTAMP()
WHERE c.client_code = 'enterprise.runtime' AND c.app_code = 'enterprise'
  AND old_grant.status = 'active' AND old_grant.action = 'view'
  AND old_grant.resource_code IN ('console:directory-user', 'tenant-runtime:console:directory-user')
  AND JSON_UNQUOTE(JSON_EXTRACT(old_grant.scope_json, '$.source')) = 'seed:d2-codocs-enterprise-directory-user-view'
  AND JSON_UNQUOTE(JSON_EXTRACT(old_grant.scope_json, '$.tenantCode')) = 'C000001'
  AND JSON_UNQUOTE(JSON_EXTRACT(old_grant.scope_json, '$.deploymentCode')) = 'C000001-test-enterprise'
  AND JSON_UNQUOTE(JSON_EXTRACT(old_grant.scope_json, '$.semanticScope')) = 'console:directory-user:view'
  AND ((old_grant.resource_code = 'console:directory-user' AND JSON_UNQUOTE(JSON_EXTRACT(old_grant.scope_json, '$.audience')) = 'data-runtime')
    OR (old_grant.resource_code = 'tenant-runtime:console:directory-user' AND JSON_UNQUOTE(JSON_EXTRACT(old_grant.scope_json, '$.audience')) = 'tenant-runtime'));
COMMIT;
