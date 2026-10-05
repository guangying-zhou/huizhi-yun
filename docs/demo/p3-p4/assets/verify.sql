-- Execute against the configured Assets database.
SET NAMES utf8mb4;

SELECT 'precondition' AS phase, 'assets.delivery_view' AS check_code,
       IF(COUNT(*) = 1, 'PASS', 'FAIL') AS status,
       '1 accepted delivery view' AS expected, CAST(COUNT(*) AS CHAR) AS actual,
       COALESCE(MAX(CONCAT(delivery_code, '|', customer_code, '|', contract_code, '|', project_code, '|', status)), 'missing') AS evidence
FROM asset_delivery_views
WHERE delivery_code = 'DEMO-P3P4-202607-DLV' AND status = 'accepted'
UNION ALL
SELECT 'precondition', 'assets.environment', IF(COUNT(*) = 1, 'PASS', 'FAIL'),
       '1 active accepted customer environment', CAST(COUNT(*) AS CHAR),
       COALESCE(MAX(CONCAT(environment_code, '|', environment_type, '|', status, '|', accepted_at)), 'missing')
FROM asset_environments
WHERE environment_code = 'DEMO-P3P4-202607-ENV'
  AND environment_type = 'customer_prod' AND status = 'active' AND accepted_at IS NOT NULL
UNION ALL
SELECT 'precondition', 'assets.customer_delivery_asset', IF(COUNT(*) = 1, 'PASS', 'FAIL'),
       '1 accepted customer delivery asset', CAST(COUNT(*) AS CHAR),
       COALESCE(MAX(CONCAT(delivery_asset_code, '|', environment_code, '|', status)), 'missing')
FROM customer_delivery_assets
WHERE delivery_asset_code = 'DEMO-P3P4-202607-CDA'
  AND customer_code = 'DEMO-P3P4-202607-CUST'
  AND contract_code = 'DEMO-P3P4-202607-CT'
  AND project_code = 'DEMO-P3P4-202607-PROJ'
  AND status = 'accepted' AND deleted_at IS NULL
UNION ALL
SELECT 'precondition', 'assets.asset_environment_binding', IF(COUNT(*) = 1, 'PASS', 'FAIL'),
       '1 active primary accepted binding', CAST(COUNT(*) AS CHAR),
       COALESCE(MAX(CONCAT(cda.delivery_asset_code, '|', env.environment_code, '|', rel.deployment_status)), 'missing')
FROM customer_delivery_asset_environment_rel rel
INNER JOIN customer_delivery_assets cda ON cda.id = rel.delivery_asset_id
INNER JOIN asset_environments env ON env.id = rel.environment_id
WHERE cda.delivery_asset_code = 'DEMO-P3P4-202607-CDA'
  AND env.environment_code = 'DEMO-P3P4-202607-ENV'
  AND rel.is_primary = 1 AND rel.status = 'active'
  AND rel.deployment_status = 'accepted' AND rel.deleted_at IS NULL
UNION ALL
SELECT 'e2e_result', 'assets.ops_document', IF(COUNT(*) = 1, 'PASS', 'FAIL'),
       '1 ops knowledge document in delivery package', CAST(COUNT(*) AS CHAR),
       COALESCE(MAX(CONCAT(ad.document_id, '|', ad.artifact_type, '|', dv.delivery_code)),
                'run Assets delivery-document link API')
FROM asset_documents ad
INNER JOIN asset_delivery_views dv ON dv.id = ad.object_id AND ad.object_type = 'delivery_view'
WHERE dv.delivery_code = 'DEMO-P3P4-202607-DLV'
  AND ad.document_id = 'd3a4c000-2026-4701-8000-000000000001'
  AND ad.artifact_type = 'ops_knowledge';
