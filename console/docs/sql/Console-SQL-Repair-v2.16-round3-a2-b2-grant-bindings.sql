-- C000001-only repair for the six ACTIVE v2.14/v2.15 grants written without
-- tenantCode/deploymentCode. Back up service_client_grants and verify that
-- exactly six eligible rows exist before apply. Never reactivate revoked rows.
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
START TRANSACTION;
UPDATE service_client_grants g
JOIN service_clients sc ON sc.id=g.service_client_id
JOIN (
 SELECT 'aims:work-item-plan-ready' AS resource_code,'execute' AS action,
   'data-runtime' AS audience,'aims:work-item-plan-ready:execute' AS semantic_scope,
   'seed:round3-a-plan-ready' AS source
 UNION ALL SELECT 'tenant-runtime:aims:work-item-plan-ready','execute',
   'tenant-runtime','aims:work-item-plan-ready:execute','seed:round3-a-plan-ready'
 UNION ALL SELECT 'aims:product-versions','scope-deliver',
   'data-runtime','aims:product-versions:scope-deliver','seed:round3-b-stage2'
 UNION ALL SELECT 'aims:product-versions','scope-reopen',
   'data-runtime','aims:product-versions:scope-reopen','seed:round3-b-stage2'
 UNION ALL SELECT 'tenant-runtime:aims:product-versions','scope-deliver',
   'tenant-runtime','aims:product-versions:scope-deliver','seed:round3-b-stage2'
 UNION ALL SELECT 'tenant-runtime:aims:product-versions','scope-reopen',
   'tenant-runtime','aims:product-versions:scope-reopen','seed:round3-b-stage2'
) expected ON expected.resource_code=g.resource_code AND expected.action=g.action
SET g.scope_json=JSON_SET(g.scope_json,
  '$.tenantCode','C000001','$.deploymentCode','C000001-test-enterprise'),
 g.updated_at=UTC_TIMESTAMP()
WHERE sc.client_code='enterprise.runtime' AND sc.app_code='enterprise'
 AND sc.status='active' AND sc.current_credential_id IS NOT NULL
 AND g.status='active'
 AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.source'))=expected.source
 AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.audience'))=expected.audience
 AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.semanticScope'))=expected.semantic_scope
 AND JSON_EXTRACT(g.scope_json,'$.tenantCode') IS NULL
 AND JSON_EXTRACT(g.scope_json,'$.deploymentCode') IS NULL;
SELECT ROW_COUNT() AS repaired_rows; -- Expect 6 on first apply, 0 on replay.
COMMIT;
