-- C000001 local only (hzy0). Apply after review, user approval and an encrypted grant-table backup.
-- Replaces the v2.31 seed for this environment. Console grant matching
-- (mapServiceAudienceScopes) accepts an audience-bound grant when its
-- semanticScope equals the requested scope; two matching physical rows are a
-- policy conflict (403). Therefore:
--   * data-runtime integration_operation: keep 13227398 (bound, semanticScope)
--     as the canonical row; revoke the inert legacy row 529971 so nobody later
--     "repairs" it into a second match. Insert nothing for this combination.
--   * tenant-runtime integration_operation: 530061 is the only row; add the
--     tenant/deployment binding and semanticScope in place.
--   * milestone-rollover: insert the two missing audience rows.
--   * notifications-due: not granted (D4: due reminders stay off on 10/8).
-- Every statement matches the exact reviewed state, so a changed environment
-- turns it into a no-op that the verify script reports as not ready.
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
START TRANSACTION;

UPDATE service_client_grants g
JOIN service_clients sc ON sc.id=g.service_client_id
SET g.status='revoked', g.updated_at=UTC_TIMESTAMP()
WHERE g.id=529971
 AND sc.client_code='aims.runtime' AND sc.app_code='aims'
 AND g.resource_code='data-runtime:aims:integration_operation' AND g.action='execute'
 AND g.status='active'
 AND JSON_EXTRACT(g.scope_json,'$.semanticScope') IS NULL
 AND JSON_EXTRACT(g.scope_json,'$.tenantCode') IS NULL;

UPDATE service_client_grants g
JOIN service_clients sc ON sc.id=g.service_client_id
LEFT JOIN (
  SELECT other.service_client_id
  FROM service_client_grants other
  WHERE other.id<>530061 AND other.status='active'
   AND (
    (JSON_UNQUOTE(JSON_EXTRACT(other.scope_json,'$.audience'))='tenant-runtime'
     AND JSON_UNQUOTE(JSON_EXTRACT(other.scope_json,'$.semanticScope'))='aims:integration_operation:execute')
    OR (JSON_EXTRACT(other.scope_json,'$.audience') IS NULL
     AND CONCAT(other.resource_code,':',other.action)='aims:integration_operation:execute')
   )
  GROUP BY other.service_client_id -- materialize: the target table cannot be read in a merged subquery
) competing ON competing.service_client_id=g.service_client_id
SET g.scope_json=JSON_SET(g.scope_json,
     '$.tenantCode','C000001',
     '$.deploymentCode','C000001-test-aims',
     '$.semanticScope','aims:integration_operation:execute',
     '$.repair','v2.32'),
    g.updated_at=UTC_TIMESTAMP()
WHERE g.id=530061
 AND sc.client_code='aims.runtime' AND sc.app_code='aims'
 AND g.resource_code='tenant-runtime:aims:integration_operation' AND g.action='execute'
 AND g.status='active'
 AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.audience'))='tenant-runtime'
 AND JSON_EXTRACT(g.scope_json,'$.semanticScope') IS NULL
 AND JSON_EXTRACT(g.scope_json,'$.tenantCode') IS NULL
 AND competing.service_client_id IS NULL;

INSERT INTO service_client_grants(service_client_id,resource_code,action,scope_json,status,created_at,updated_at)
SELECT sc.id,CONCAT(a.audience,':aims:milestone-rollover'),'execute',
 JSON_OBJECT('source','repair:v2.32','purpose','aims-unified-scheduler',
  'tenantCode','C000001','deploymentCode','C000001-test-aims',
  'audience',a.audience,'semanticScope','aims:milestone-rollover:execute'),
 'active',UTC_TIMESTAMP(),UTC_TIMESTAMP()
FROM service_clients sc
JOIN service_client_credentials scc ON scc.id=sc.current_credential_id AND scc.status='active'
CROSS JOIN (SELECT 'data-runtime' AS audience UNION ALL SELECT 'tenant-runtime') a
WHERE sc.client_code='aims.runtime' AND sc.app_code='aims' AND sc.status='active'
 AND NOT EXISTS (
  SELECT 1 FROM service_client_grants existing
  WHERE existing.service_client_id=sc.id
   AND (
    (existing.resource_code=CONCAT(a.audience,':aims:milestone-rollover') AND existing.action='execute')
    OR (JSON_UNQUOTE(JSON_EXTRACT(existing.scope_json,'$.audience'))=a.audience
        AND JSON_UNQUOTE(JSON_EXTRACT(existing.scope_json,'$.semanticScope'))='aims:milestone-rollover:execute')
    -- A legacy unbound row with the semantic name also matches; never add a second match.
    OR (JSON_EXTRACT(existing.scope_json,'$.audience') IS NULL
        AND CONCAT(existing.resource_code,':',existing.action)='aims:milestone-rollover:execute')
   )
 );

COMMIT;
