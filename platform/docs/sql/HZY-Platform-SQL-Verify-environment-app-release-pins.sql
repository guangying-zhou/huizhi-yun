-- Read-only. Set @pin_tenant and @pin_environment explicitly in the review session.
SELECT COLUMN_NAME, COLUMN_TYPE FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='platform_app_role_scopes' AND COLUMN_NAME='source_type';
SELECT * FROM tenant_environment_app_release_sets
WHERE tenant_code=@pin_tenant AND environment=@pin_environment;
SELECT p.app_code,p.release_id,r.release_version,r.source_tag,r.manifest_id,r.status,m.manifest_hash,m.status AS manifest_status
FROM tenant_environment_app_releases p
LEFT JOIN platform_app_releases r ON r.id=p.release_id AND r.app_code=p.app_code
LEFT JOIN platform_app_manifests m ON m.id=r.manifest_id AND m.app_code=r.app_code
WHERE p.tenant_code=@pin_tenant AND p.environment=@pin_environment
ORDER BY p.app_code;
SELECT id,actor_uid,reason,review_hash,created_at
FROM platform_environment_app_release_audits
WHERE tenant_code=@pin_tenant AND environment=@pin_environment
ORDER BY id DESC LIMIT 20;
-- Non-null pins require exact released + active rows. NULL is deliberately latest.
-- The POST /preview result is required for full bundle/permission/scope comparison;
-- this SQL does not prove APF zero diff and must not replace that gate.
