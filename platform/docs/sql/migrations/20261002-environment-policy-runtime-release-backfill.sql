-- CANDIDATE ONLY. Pause policy-generation writers, not delivery GETs.
-- Encrypted backup verified decryptable; preflight must return zero rows:
SELECT b.id,b.tenant_code,b.environment FROM policy_bundles b
JOIN tenant_policy_revisions r ON r.tenant_code=b.tenant_code
WHERE b.id=(SELECT MAX(x.id) FROM policy_bundles x WHERE x.tenant_code=b.tenant_code AND x.environment=b.environment)
  AND b.policy_revision=r.policy_revision AND NOT(b.policy_hash <=> r.policy_hash);
-- Also verify expected prod revision/hash/signature/targets and all allowed environments.
-- Run in the operator-owned transaction; no COMMIT here. No upsert overwrite.
INSERT INTO tenant_environment_policy_revisions
 (tenant_code,environment,policy_revision,policy_hash,policy_updated_at)
SELECT e.tenant_code,e.environment,GREATEST(e.max_revision,COALESCE(r.policy_revision,0)),
 CASE WHEN b.policy_revision=r.policy_revision AND b.policy_revision=e.max_revision
       AND b.policy_hash IS NOT NULL AND b.policy_hash=r.policy_hash THEN b.policy_hash ELSE NULL END,
 CASE WHEN b.policy_revision=r.policy_revision AND b.policy_revision=e.max_revision
       AND b.policy_hash IS NOT NULL AND b.policy_hash=r.policy_hash THEN r.policy_updated_at ELSE NULL END
FROM (SELECT tenant_code,environment,MAX(policy_revision) AS max_revision,MAX(id) AS latest_id
      FROM policy_bundles GROUP BY tenant_code,environment) e
JOIN policy_bundles b ON b.id=e.latest_id
LEFT JOIN tenant_policy_revisions r ON r.tenant_code=e.tenant_code;
-- ROW_COUNT must equal reviewed environment groups; verify before caller COMMIT.
-- Intentionally no stable mapping, mode activation or desired_version changes.
