-- Every row-level anomaly query must be empty; PASS is not inferred from SQL exit=0.
SELECT r.tenant_code,r.environment FROM tenant_environment_policy_revisions r
JOIN policy_bundles b ON b.tenant_code=r.tenant_code AND b.environment=r.environment
GROUP BY r.tenant_code,r.environment,r.policy_revision
HAVING r.policy_revision < MAX(b.policy_revision);
SELECT r.tenant_code,r.environment FROM tenant_environment_policy_revisions r
WHERE r.environment NOT IN ('prod','test','dev');
SELECT i.id FROM tenant_runtime_instances i
WHERE i.release_update_mode NOT IN ('pinned','tracking','retired');
SELECT r.tenant_code,r.environment FROM tenant_environment_policy_revisions r
LEFT JOIN policy_bundles b ON b.tenant_code=r.tenant_code AND b.environment=r.environment
 AND b.policy_revision=r.policy_revision AND b.policy_hash=r.policy_hash
WHERE r.policy_hash IS NOT NULL AND b.id IS NULL;
SELECT CASE WHEN COUNT(*)=1 THEN 'PASS' ELSE 'FAIL' END AS release_mode_column
FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='tenant_runtime_instances'
 AND column_name='release_update_mode' AND column_default='pinned';
-- For rollout compare all legacy tables / non-target rows to encrypted before snapshots.
-- Assert current prod bundle id/version/hash/revision/signature/target IDs unchanged.
