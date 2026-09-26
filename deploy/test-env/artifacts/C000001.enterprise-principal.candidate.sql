-- PROPOSED ONLY. Run only through the approved administrator process after target activation.
-- Runtime schema privileges: exactly SELECT, INSERT, UPDATE, DELETE.
-- Runtime view metadata privileges: exactly SHOW VIEW on these 55 compatibility views.
-- No source-schema, other-table, DDL, global, role, or GRANT OPTION privileges.
GRANT SELECT, INSERT, UPDATE, DELETE
ON `hzy_enterprise_shadow_review_20260913`.*
TO 'hzy_enterprise_test_runtime'@'localhost';

GRANT SHOW VIEW ON `hzy_enterprise_shadow_review_20260913`.`aims_project_members` TO 'hzy_enterprise_test_runtime'@'localhost';
GRANT SHOW VIEW ON `hzy_enterprise_shadow_review_20260913`.`aims_project_products` TO 'hzy_enterprise_test_runtime'@'localhost';
GRANT SHOW VIEW ON `hzy_enterprise_shadow_review_20260913`.`aims_projects` TO 'hzy_enterprise_test_runtime'@'localhost';
GRANT SHOW VIEW ON `hzy_enterprise_shadow_review_20260913`.`company_weekly_summaries` TO 'hzy_enterprise_test_runtime'@'localhost';
GRANT SHOW VIEW ON `hzy_enterprise_shadow_review_20260913`.`company_weekly_summary_items` TO 'hzy_enterprise_test_runtime'@'localhost';
GRANT SHOW VIEW ON `hzy_enterprise_shadow_review_20260913`.`company_weekly_summary_versions` TO 'hzy_enterprise_test_runtime'@'localhost';
GRANT SHOW VIEW ON `hzy_enterprise_shadow_review_20260913`.`product_activity_logs` TO 'hzy_enterprise_test_runtime'@'localhost';
GRANT SHOW VIEW ON `hzy_enterprise_shadow_review_20260913`.`product_catalog_control` TO 'hzy_enterprise_test_runtime'@'localhost';
GRANT SHOW VIEW ON `hzy_enterprise_shadow_review_20260913`.`product_command_receipts` TO 'hzy_enterprise_test_runtime'@'localhost';
GRANT SHOW VIEW ON `hzy_enterprise_shadow_review_20260913`.`product_component_sources` TO 'hzy_enterprise_test_runtime'@'localhost';
GRANT SHOW VIEW ON `hzy_enterprise_shadow_review_20260913`.`product_components` TO 'hzy_enterprise_test_runtime'@'localhost';
GRANT SHOW VIEW ON `hzy_enterprise_shadow_review_20260913`.`product_features` TO 'hzy_enterprise_test_runtime'@'localhost';
GRANT SHOW VIEW ON `hzy_enterprise_shadow_review_20260913`.`product_feedback_bindings` TO 'hzy_enterprise_test_runtime'@'localhost';
GRANT SHOW VIEW ON `hzy_enterprise_shadow_review_20260913`.`product_line_workspaces` TO 'hzy_enterprise_test_runtime'@'localhost';
GRANT SHOW VIEW ON `hzy_enterprise_shadow_review_20260913`.`product_members` TO 'hzy_enterprise_test_runtime'@'localhost';
GRANT SHOW VIEW ON `hzy_enterprise_shadow_review_20260913`.`product_planning_cycle_items` TO 'hzy_enterprise_test_runtime'@'localhost';
GRANT SHOW VIEW ON `hzy_enterprise_shadow_review_20260913`.`product_planning_cycles` TO 'hzy_enterprise_test_runtime'@'localhost';
GRANT SHOW VIEW ON `hzy_enterprise_shadow_review_20260913`.`product_planning_dependencies` TO 'hzy_enterprise_test_runtime'@'localhost';
GRANT SHOW VIEW ON `hzy_enterprise_shadow_review_20260913`.`product_planning_item_requests` TO 'hzy_enterprise_test_runtime'@'localhost';
GRANT SHOW VIEW ON `hzy_enterprise_shadow_review_20260913`.`product_planning_items` TO 'hzy_enterprise_test_runtime'@'localhost';
GRANT SHOW VIEW ON `hzy_enterprise_shadow_review_20260913`.`product_release_events` TO 'hzy_enterprise_test_runtime'@'localhost';
GRANT SHOW VIEW ON `hzy_enterprise_shadow_review_20260913`.`product_release_records` TO 'hzy_enterprise_test_runtime'@'localhost';
GRANT SHOW VIEW ON `hzy_enterprise_shadow_review_20260913`.`product_request_delivery_links` TO 'hzy_enterprise_test_runtime'@'localhost';
GRANT SHOW VIEW ON `hzy_enterprise_shadow_review_20260913`.`product_request_features` TO 'hzy_enterprise_test_runtime'@'localhost';
GRANT SHOW VIEW ON `hzy_enterprise_shadow_review_20260913`.`product_request_sources` TO 'hzy_enterprise_test_runtime'@'localhost';
GRANT SHOW VIEW ON `hzy_enterprise_shadow_review_20260913`.`product_requests` TO 'hzy_enterprise_test_runtime'@'localhost';
GRANT SHOW VIEW ON `hzy_enterprise_shadow_review_20260913`.`product_version_acceptances` TO 'hzy_enterprise_test_runtime'@'localhost';
GRANT SHOW VIEW ON `hzy_enterprise_shadow_review_20260913`.`product_version_features` TO 'hzy_enterprise_test_runtime'@'localhost';
GRANT SHOW VIEW ON `hzy_enterprise_shadow_review_20260913`.`product_version_plan_confirmations` TO 'hzy_enterprise_test_runtime'@'localhost';
GRANT SHOW VIEW ON `hzy_enterprise_shadow_review_20260913`.`product_version_plan_scopes` TO 'hzy_enterprise_test_runtime'@'localhost';
GRANT SHOW VIEW ON `hzy_enterprise_shadow_review_20260913`.`product_version_plans` TO 'hzy_enterprise_test_runtime'@'localhost';
GRANT SHOW VIEW ON `hzy_enterprise_shadow_review_20260913`.`product_versions` TO 'hzy_enterprise_test_runtime'@'localhost';
GRANT SHOW VIEW ON `hzy_enterprise_shadow_review_20260913`.`product_workspaces` TO 'hzy_enterprise_test_runtime'@'localhost';
GRANT SHOW VIEW ON `hzy_enterprise_shadow_review_20260913`.`project_documents` TO 'hzy_enterprise_test_runtime'@'localhost';
GRANT SHOW VIEW ON `hzy_enterprise_shadow_review_20260913`.`project_management_fact_snapshots` TO 'hzy_enterprise_test_runtime'@'localhost';
GRANT SHOW VIEW ON `hzy_enterprise_shadow_review_20260913`.`project_weekly_report_versions` TO 'hzy_enterprise_test_runtime'@'localhost';
GRANT SHOW VIEW ON `hzy_enterprise_shadow_review_20260913`.`requirement_contents` TO 'hzy_enterprise_test_runtime'@'localhost';
GRANT SHOW VIEW ON `hzy_enterprise_shadow_review_20260913`.`requirement_item_contents` TO 'hzy_enterprise_test_runtime'@'localhost';
GRANT SHOW VIEW ON `hzy_enterprise_shadow_review_20260913`.`requirement_items` TO 'hzy_enterprise_test_runtime'@'localhost';
GRANT SHOW VIEW ON `hzy_enterprise_shadow_review_20260913`.`time_entries` TO 'hzy_enterprise_test_runtime'@'localhost';
GRANT SHOW VIEW ON `hzy_enterprise_shadow_review_20260913`.`time_entry_review_events` TO 'hzy_enterprise_test_runtime'@'localhost';
GRANT SHOW VIEW ON `hzy_enterprise_shadow_review_20260913`.`weekly_report_obligations` TO 'hzy_enterprise_test_runtime'@'localhost';
GRANT SHOW VIEW ON `hzy_enterprise_shadow_review_20260913`.`weekly_reporting_periods` TO 'hzy_enterprise_test_runtime'@'localhost';
GRANT SHOW VIEW ON `hzy_enterprise_shadow_review_20260913`.`work_items` TO 'hzy_enterprise_test_runtime'@'localhost';
GRANT SHOW VIEW ON `hzy_enterprise_shadow_review_20260913`.`asset_category_groups` TO 'hzy_enterprise_test_runtime'@'localhost';
GRANT SHOW VIEW ON `hzy_enterprise_shadow_review_20260913`.`asset_category_items` TO 'hzy_enterprise_test_runtime'@'localhost';
GRANT SHOW VIEW ON `hzy_enterprise_shadow_review_20260913`.`asset_delivery_products` TO 'hzy_enterprise_test_runtime'@'localhost';
GRANT SHOW VIEW ON `hzy_enterprise_shadow_review_20260913`.`asset_delivery_views` TO 'hzy_enterprise_test_runtime'@'localhost';
GRANT SHOW VIEW ON `hzy_enterprise_shadow_review_20260913`.`asset_documents` TO 'hzy_enterprise_test_runtime'@'localhost';
GRANT SHOW VIEW ON `hzy_enterprise_shadow_review_20260913`.`asset_events` TO 'hzy_enterprise_test_runtime'@'localhost';
GRANT SHOW VIEW ON `hzy_enterprise_shadow_review_20260913`.`asset_items` TO 'hzy_enterprise_test_runtime'@'localhost';
GRANT SHOW VIEW ON `hzy_enterprise_shadow_review_20260913`.`product_asset_bases` TO 'hzy_enterprise_test_runtime'@'localhost';
GRANT SHOW VIEW ON `hzy_enterprise_shadow_review_20260913`.`product_asset_resources` TO 'hzy_enterprise_test_runtime'@'localhost';
GRANT SHOW VIEW ON `hzy_enterprise_shadow_review_20260913`.`product_assets` TO 'hzy_enterprise_test_runtime'@'localhost';
GRANT SHOW VIEW ON `hzy_enterprise_shadow_review_20260913`.`technology_bases` TO 'hzy_enterprise_test_runtime'@'localhost';

-- Do not grant SHOW VIEW on *.
