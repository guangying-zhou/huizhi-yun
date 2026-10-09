-- CANDIDATE ONLY. Executed by console/scripts/v228-enterprise-host-grants.mjs
-- inside its reviewed, tenant-bound transaction. The helper fills the
-- temporary v228_targets table with exact active grant IDs after reviewHash
-- comparison. This file must not be run alone.
UPDATE service_client_grants g
JOIN v228_targets t ON t.id = g.id
SET g.status = 'revoked', g.updated_at = UTC_TIMESTAMP()
WHERE g.status = 'active';
