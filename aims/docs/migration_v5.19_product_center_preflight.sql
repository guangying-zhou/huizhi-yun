-- READ ONLY. Run against the Aims schema before v5.19.
-- No product names, user personal data, or credentials are returned.
-- Assets code resolution and actual grants are checked through their APIs,
-- never by joining a second application's database here.

SELECT 'versions_total' AS check_code, COUNT(*) AS row_count FROM product_versions
UNION ALL SELECT 'version_features_total', COUNT(*) FROM product_version_features
UNION ALL SELECT 'project_product_links_total', COUNT(*) FROM aims_project_products
UNION ALL SELECT 'released_versions', COUNT(*) FROM product_versions WHERE status='released'
UNION ALL SELECT 'archived_versions', COUNT(*) FROM product_versions WHERE status='archived'
UNION ALL SELECT 'versions_without_owner_project', COUNT(*) FROM product_versions WHERE owner_project_id IS NULL;

SELECT 'version_owner_project_missing' AS check_code, COUNT(*) AS row_count
FROM product_versions v LEFT JOIN aims_projects p ON p.id=v.owner_project_id
WHERE v.owner_project_id IS NOT NULL AND p.id IS NULL
UNION ALL
SELECT 'feature_version_missing', COUNT(*)
FROM product_version_features f LEFT JOIN product_versions v ON v.id=f.version_id WHERE v.id IS NULL
UNION ALL
SELECT 'work_item_version_missing', COUNT(*)
FROM work_items w LEFT JOIN product_versions v ON v.id=w.version_id
WHERE w.version_id IS NOT NULL AND v.id IS NULL
UNION ALL
SELECT 'work_item_feature_version_mismatch', COUNT(*)
FROM work_items w LEFT JOIN product_version_features f ON f.id=w.feature_id
WHERE w.feature_id IS NOT NULL AND (f.id IS NULL OR w.version_id IS NULL OR f.version_id<>w.version_id)
UNION ALL
SELECT 'project_binding_product_version_mismatch', COUNT(*)
FROM aims_project_products p LEFT JOIN product_versions v ON v.id=p.version_id
WHERE p.version_id IS NOT NULL AND (v.id IS NULL OR BINARY v.product_code<>BINARY p.product_code);

SELECT TABLE_NAME,COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA=DATABASE()
  AND TABLE_NAME IN ('product_versions','product_version_features','product_workspaces','product_planning_cycles','product_command_receipts','product_catalog_control','product_catalog_refreshes','product_catalog_page_receipts','product_catalog_projection')
ORDER BY TABLE_NAME,ORDINAL_POSITION;
