-- C000001 local only. PREPARED, NOT EXECUTED. Run only with separate user approval when,
-- after v2.32, the in-use data-runtime aims:integration_operation:execute issue is no
-- longer 200, or after N7 tenant-runtime / milestone-rollover issuance hits
-- service_grant_policy_conflict.
--   * 530061: restore the exact pre-v2.32 scope_json snapshot (only if it still holds
--     the v2.32 repair values).
--   * rollover rows inserted by v2.32: active -> revoked, never deleted.
--   * 529971 stays revoked: it was inert, restoring it gains nothing.
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
START TRANSACTION;

UPDATE service_client_grants g
JOIN service_clients sc ON sc.id=g.service_client_id
SET g.scope_json=JSON_OBJECT('source','seed:product-center-20260907','audience','tenant-runtime'),
    g.updated_at=UTC_TIMESTAMP()
WHERE g.id=530061
 AND sc.client_code='aims.runtime' AND sc.app_code='aims'
 AND g.resource_code='tenant-runtime:aims:integration_operation' AND g.action='execute'
 AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.repair'))='v2.32'
 AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.source'))='seed:product-center-20260907';

UPDATE service_client_grants g
JOIN service_clients sc ON sc.id=g.service_client_id
SET g.status='revoked', g.updated_at=UTC_TIMESTAMP()
WHERE sc.client_code='aims.runtime' AND sc.app_code='aims'
 AND g.resource_code IN ('data-runtime:aims:milestone-rollover','tenant-runtime:aims:milestone-rollover')
 AND g.action='execute' AND g.status='active'
 AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.source'))='repair:v2.32';

COMMIT;
