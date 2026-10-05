-- Console SQL Seed v2.3: Altoc 商机创建 Aims 售前/销售项目的精确 capability。
-- Generated only; do not auto-run.

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
START TRANSACTION;

-- 直接访问 Aims BFF（aud=aims）。
INSERT INTO service_client_grants (
  service_client_id, resource_code, action, scope_json, status, created_at, updated_at
)
SELECT sc.id, 'aims:project', 'create-from-opportunity',
       JSON_OBJECT(
         'source','seed:v2.3',
         'purpose','altoc-opportunity-create-aims-project',
         'audience','aims',
         'endpoints',JSON_ARRAY('/api/v1/service/projects/from-opportunity')
       ),
       'active', UTC_TIMESTAMP(), UTC_TIMESTAMP()
FROM service_clients sc
WHERE sc.status='active' AND (sc.app_code='altoc' OR sc.client_code IN ('altoc','altoc.runtime'))
ON DUPLICATE KEY UPDATE scope_json=VALUES(scope_json),status='active',updated_at=UTC_TIMESTAMP();

-- 经 data-runtime / tenant-runtime 调用时使用带 audience 前缀的精确 scope。
INSERT INTO service_client_grants (
  service_client_id, resource_code, action, scope_json, status, created_at, updated_at
)
SELECT sc.id, audience.resource_code, 'create-from-opportunity',
       JSON_OBJECT(
         'source','seed:v2.3',
         'purpose','altoc-opportunity-create-aims-project-runtime',
         'audience',audience.audience,
         'endpoints',JSON_ARRAY('/v1/aims/service/projects/from-opportunity')
       ),
       'active', UTC_TIMESTAMP(), UTC_TIMESTAMP()
FROM service_clients sc
JOIN (
  SELECT 'data-runtime:aims:project' AS resource_code, 'data-runtime' AS audience
  UNION ALL
  SELECT 'tenant-runtime:aims:project', 'tenant-runtime'
) audience
WHERE sc.status='active' AND (sc.app_code='altoc' OR sc.client_code IN ('altoc','altoc.runtime'))
ON DUPLICATE KEY UPDATE scope_json=VALUES(scope_json),status='active',updated_at=UTC_TIMESTAMP();

COMMIT;
