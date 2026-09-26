-- Read-only verification. Real raw-scope issuance and empty signed claim are
-- still required before the local Workflow test can submit any completion.
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
SELECT sc.client_code,g.resource_code,g.action,
  CASE WHEN g.id IS NULL THEN 'MISSING' WHEN g.status<>'active' THEN 'NOT_ACTIVE'
    WHEN JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.source'))<>'seed:round3-a2-aims-scheduler'
      OR JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.audience'))<>'data-runtime'
      OR JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.semanticScope'))<>'aims:integration_operation:execute'
      OR JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.tenantCode'))<>'C000001'
      OR JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.deploymentCode'))<>'C000001-test-aims'
      THEN 'BINDING_MISMATCH' ELSE 'ACTIVE' END verification_status
FROM service_clients sc LEFT JOIN service_client_grants g ON g.service_client_id=sc.id
  AND g.resource_code='aims:integration_operation' AND g.action='execute'
WHERE sc.client_code='aims.runtime' AND sc.app_code='aims' AND sc.status='active';
