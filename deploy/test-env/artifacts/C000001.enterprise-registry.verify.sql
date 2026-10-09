-- Read-only post-copy expectations: generation must remain 0 before explicit activation.
SELECT tenant_code,environment_code,runtime_deployment,schema_version,generation FROM `hzy_enterprise_shadow_review_20260913`.enterprise_schema_registry WHERE id=1;
-- Expected C000001 / test / c000001-test-tenant-runtime / enterprise.v1 / 0
