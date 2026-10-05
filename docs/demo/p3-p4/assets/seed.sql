-- Execute against the configured Assets database.
SET NAMES utf8mb4;
START TRANSACTION;

INSERT INTO product_assets (
  product_code, product_name, product_line, customer_domain, business_domain,
  product_level, asset_level, status, summary, built_at,
  business_owner_uid, technical_owner_uid, project_code, notes, created_by, updated_by
) VALUES (
  'DEMO-P3P4-202607-PRODUCT', 'P3/P4 演示交付产品', '演示产品线', '企业服务', '服务运营',
  'L2', 'A2', 'stable', 'DEMO-P3P4-202607 产品主档', '2026-07-01',
  'DEMO-P3P4-202607-EMP', 'DEMO-P3P4-202607-EMP', 'DEMO-P3P4-202607-PROJ',
  'DEMO-P3P4-202607', 'demo-p3p4', 'demo-p3p4'
)
ON DUPLICATE KEY UPDATE
  product_name = VALUES(product_name),
  product_line = VALUES(product_line),
  customer_domain = VALUES(customer_domain),
  business_domain = VALUES(business_domain),
  status = VALUES(status),
  project_code = VALUES(project_code),
  notes = VALUES(notes),
  updated_by = VALUES(updated_by);

INSERT INTO asset_delivery_views (
  delivery_code, delivery_name, customer_code, contract_code, project_code,
  status, owner_uid, go_live_at, accepted_at, notes, created_by, updated_by
) VALUES (
  'DEMO-P3P4-202607-DLV', 'P3/P4 演示客户交付视图',
  'DEMO-P3P4-202607-CUST', 'DEMO-P3P4-202607-CT', 'DEMO-P3P4-202607-PROJ',
  'accepted', 'DEMO-P3P4-202607-EMP', '2026-07-15', '2026-07-20',
  'DEMO-P3P4-202607 交付包', 'demo-p3p4', 'demo-p3p4'
)
ON DUPLICATE KEY UPDATE
  delivery_name = VALUES(delivery_name),
  customer_code = VALUES(customer_code),
  contract_code = VALUES(contract_code),
  project_code = VALUES(project_code),
  status = VALUES(status),
  owner_uid = VALUES(owner_uid),
  go_live_at = VALUES(go_live_at),
  accepted_at = VALUES(accepted_at),
  notes = VALUES(notes),
  updated_by = VALUES(updated_by);

INSERT INTO asset_environments (
  environment_code, environment_name, environment_type,
  project_code, customer_code, contract_code, status,
  deployment_mode, region, idempotency_key, go_live_at, accepted_at,
  dept_code, owner_uid, maintainer_uid, topology_summary, notes,
  created_by, updated_by
) VALUES (
  'DEMO-P3P4-202607-ENV', 'P3/P4 演示客户生产环境', 'customer_prod',
  'DEMO-P3P4-202607-PROJ', 'DEMO-P3P4-202607-CUST', 'DEMO-P3P4-202607-CT', 'active',
  'managed_cloud', 'demo-region', 'DEMO-P3P4-202607-ENV-IDEMPOTENCY',
  '2026-07-15 10:00:00', '2026-07-20 16:00:00',
  'DEMO-P3P4-202607-DEPT', 'DEMO-P3P4-202607-EMP', 'DEMO-P3P4-202607-EMP',
  'DEMO-P3P4-202607 单节点演示拓扑', 'DEMO-P3P4-202607', 'demo-p3p4', 'demo-p3p4'
)
ON DUPLICATE KEY UPDATE
  environment_name = VALUES(environment_name),
  environment_type = VALUES(environment_type),
  project_code = VALUES(project_code),
  customer_code = VALUES(customer_code),
  contract_code = VALUES(contract_code),
  status = VALUES(status),
  deployment_mode = VALUES(deployment_mode),
  region = VALUES(region),
  go_live_at = VALUES(go_live_at),
  accepted_at = VALUES(accepted_at),
  owner_uid = VALUES(owner_uid),
  maintainer_uid = VALUES(maintainer_uid),
  notes = VALUES(notes),
  updated_by = VALUES(updated_by);

INSERT INTO asset_delivery_environments (delivery_view_id, environment_id, relation_type)
SELECT dv.id, env.id, 'primary'
FROM asset_delivery_views dv
INNER JOIN asset_environments env ON env.environment_code = 'DEMO-P3P4-202607-ENV'
WHERE dv.delivery_code = 'DEMO-P3P4-202607-DLV'
ON DUPLICATE KEY UPDATE relation_type = VALUES(relation_type);

INSERT INTO asset_delivery_products (delivery_view_id, product_asset_id, relation_type, created_by)
SELECT dv.id, pa.id, 'delivered_product', 'demo-p3p4'
FROM asset_delivery_views dv
INNER JOIN product_assets pa ON pa.product_code = 'DEMO-P3P4-202607-PRODUCT'
WHERE dv.delivery_code = 'DEMO-P3P4-202607-DLV'
ON DUPLICATE KEY UPDATE created_by = VALUES(created_by);

INSERT INTO customer_delivery_assets (
  delivery_asset_code, customer_code, contract_code, contract_line_code,
  project_code, delivery_view_code, product_code, product_name, product_version,
  asset_kind, deployment_mode, instance_key, environment_code,
  status, delivered_at, go_live_at, accepted_at,
  warranty_start_at, warranty_end_at, support_expiry_at,
  source_app, source_biz_code, source_plan_code, idempotency_key,
  created_by, updated_by, deleted_at
) VALUES (
  'DEMO-P3P4-202607-CDA', 'DEMO-P3P4-202607-CUST', 'DEMO-P3P4-202607-CT',
  'DEMO-P3P4-202607-CTL', 'DEMO-P3P4-202607-PROJ', 'DEMO-P3P4-202607-DLV',
  'DEMO-P3P4-202607-PRODUCT', 'P3/P4 演示交付产品', '2026.07',
  'software', 'managed_cloud', 'DEMO-P3P4-202607-INSTANCE', 'DEMO-P3P4-202607-ENV',
  'accepted', '2026-07-15 10:00:00', '2026-07-15 10:00:00', '2026-07-20 16:00:00',
  '2026-07-20 16:00:00', '2027-07-19 23:59:59', '2027-07-31 23:59:59',
  'altoc', 'DEMO-P3P4-202607-CTL', 'DEMO-P3P4-202607-PLAN',
  'DEMO-P3P4-202607-CDA-IDEMPOTENCY', 'demo-p3p4', 'demo-p3p4', NULL
)
ON DUPLICATE KEY UPDATE
  customer_code = VALUES(customer_code),
  contract_code = VALUES(contract_code),
  contract_line_code = VALUES(contract_line_code),
  project_code = VALUES(project_code),
  delivery_view_code = VALUES(delivery_view_code),
  product_code = VALUES(product_code),
  product_name = VALUES(product_name),
  product_version = VALUES(product_version),
  environment_code = VALUES(environment_code),
  status = VALUES(status),
  accepted_at = VALUES(accepted_at),
  support_expiry_at = VALUES(support_expiry_at),
  source_biz_code = VALUES(source_biz_code),
  source_plan_code = VALUES(source_plan_code),
  deleted_at = NULL,
  updated_by = VALUES(updated_by);

INSERT INTO customer_delivery_asset_environment_rel (
  delivery_asset_id, environment_id, relation_type, is_primary,
  deployment_status, deployed_version, effective_from, status,
  source_project_code, created_by, updated_by, deleted_at
)
SELECT cda.id, env.id, 'production', 1, 'accepted', '2026.07',
       '2026-07-15 10:00:00', 'active', 'DEMO-P3P4-202607-PROJ',
       'demo-p3p4', 'demo-p3p4', NULL
FROM customer_delivery_assets cda
INNER JOIN asset_environments env ON env.environment_code = 'DEMO-P3P4-202607-ENV'
WHERE cda.delivery_asset_code = 'DEMO-P3P4-202607-CDA'
ON DUPLICATE KEY UPDATE
  is_primary = 1,
  deployment_status = VALUES(deployment_status),
  deployed_version = VALUES(deployed_version),
  effective_from = VALUES(effective_from),
  effective_to = NULL,
  status = 'active',
  source_project_code = VALUES(source_project_code),
  deleted_at = NULL,
  updated_by = VALUES(updated_by);

COMMIT;
