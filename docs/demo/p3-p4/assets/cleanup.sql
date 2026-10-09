-- Execute against the configured Assets database.
SET NAMES utf8mb4;
START TRANSACTION;

DELETE ad
FROM asset_documents ad
INNER JOIN asset_delivery_views dv ON dv.id = ad.object_id AND ad.object_type = 'delivery_view'
WHERE dv.delivery_code = 'DEMO-P3P4-202607-DLV'
  AND ad.document_id = 'd3a4c000-2026-4701-8000-000000000001'
  AND JSON_UNQUOTE(JSON_EXTRACT(ad.source_context, '$.customer_code')) = 'DEMO-P3P4-202607-CUST'
  AND JSON_UNQUOTE(JSON_EXTRACT(ad.source_context, '$.project_code')) = 'DEMO-P3P4-202607-PROJ';

DELETE rel
FROM customer_delivery_asset_environment_rel rel
INNER JOIN customer_delivery_assets cda ON cda.id = rel.delivery_asset_id
INNER JOIN asset_environments env ON env.id = rel.environment_id
WHERE cda.delivery_asset_code = 'DEMO-P3P4-202607-CDA'
  AND env.environment_code = 'DEMO-P3P4-202607-ENV';

DELETE dp
FROM asset_delivery_products dp
INNER JOIN asset_delivery_views dv ON dv.id = dp.delivery_view_id
INNER JOIN product_assets pa ON pa.id = dp.product_asset_id
WHERE dv.delivery_code = 'DEMO-P3P4-202607-DLV'
  AND pa.product_code = 'DEMO-P3P4-202607-PRODUCT';

DELETE de
FROM asset_delivery_environments de
INNER JOIN asset_delivery_views dv ON dv.id = de.delivery_view_id
INNER JOIN asset_environments env ON env.id = de.environment_id
WHERE dv.delivery_code = 'DEMO-P3P4-202607-DLV'
  AND env.environment_code = 'DEMO-P3P4-202607-ENV';

DELETE FROM customer_delivery_assets
WHERE delivery_asset_code = 'DEMO-P3P4-202607-CDA';

DELETE FROM asset_environments
WHERE environment_code = 'DEMO-P3P4-202607-ENV'
  AND idempotency_key = 'DEMO-P3P4-202607-ENV-IDEMPOTENCY';

DELETE FROM asset_delivery_views
WHERE delivery_code = 'DEMO-P3P4-202607-DLV';

DELETE FROM product_assets
WHERE product_code = 'DEMO-P3P4-202607-PRODUCT';

COMMIT;
