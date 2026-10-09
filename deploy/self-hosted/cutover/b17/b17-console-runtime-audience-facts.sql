-- S4 B17 fix 9: audience facts for the legacy console.runtime grants in prod hzy_console (C000001).
-- The restored rows carry {"source":"tenant-runtime-bootstrap"} only; the Runtime signer (data-runtime/internal/apps/console/
-- auth_service_scope_mapping.go) keeps no legacy fallback, so every console.runtime scope fails with insufficient_scope (gate a:
-- console:service-client:consume). Facts follow the former compatibility table (git show cd8758f3^:data-runtime/internal/apps/console/
-- auth_service_scope_mapping.go: console.runtime "console:" prefix -> data-runtime plus the exact entries) and are cross-checked
-- against the rows hzy0 received in the 2026-09-26 ADR-017 audience-facts migration. Only rows where both sources give the same
-- audience and semanticScope = resource:action are listed (86). Seven active console.runtime rows are NOT touched:
-- ids 2453 (workflow:action_defs:sync), 9676 (connector-runtime:directory:sync), 76763 (console.schema:read) - no fact in either source;
-- 54638787/54638788 (console:hr-source-sync view/admin) - legacy table yes, hzy0 no;
-- 69143051/69143052 (console:policy-bundle read/write) - B17 fix 5 already holds the audience-bound rows data-runtime:console:policy-bundle,
--   and two grants with the same audience+semanticScope but different physical scope make the signer answer service_grant_policy_conflict.
-- No other client is touched; no rows are added. Each row is changed by id and only if its current scope_json is byte-identical to the
-- preflight value (CAS); resource, action and status are not modified. Guard: if any of the 86 rows differs, nothing is written.
-- One transaction; mysql client.
SET @cid = (SELECT id FROM service_clients WHERE client_code='console.runtime' AND app_code='console' AND status='active');
DROP TEMPORARY TABLE IF EXISTS b17_audience_facts;
CREATE TEMPORARY TABLE b17_audience_facts AS
  SELECT * FROM (
SELECT 2443 AS id,'data-runtime:runtime' AS resource_code,'update' AS action,'data-runtime' AS audience,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 2444 AS id,'notification-runtime' AS resource_code,'send' AS action,'notification-runtime' AS audience,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 2445 AS id,'tenant-runtime:runtime' AS resource_code,'update' AS action,'tenant-runtime' AS audience,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 2446 AS id,'webdev:issue' AS resource_code,'read' AS action,'webdev' AS audience,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 2447 AS id,'webdev:issue' AS resource_code,'write' AS action,'webdev' AS audience,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 2448 AS id,'aims:notification-details' AS resource_code,'authorize' AS action,'aims' AS audience,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 2449 AS id,'assets:notification-details' AS resource_code,'authorize' AS action,'assets' AS audience,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 2450 AS id,'altoc:notification-details' AS resource_code,'authorize' AS action,'altoc' AS audience,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 2451 AS id,'finance:notification-details' AS resource_code,'authorize' AS action,'finance' AS audience,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 2452 AS id,'people:notification-details' AS resource_code,'authorize' AS action,'people' AS audience,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 2454 AS id,'workflow:notification-details' AS resource_code,'authorize' AS action,'workflow' AS audience,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 2455 AS id,'workflow' AS resource_code,'proxy' AS action,'workflow' AS audience,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 6102 AS id,'connector-runtime:notifications' AS resource_code,'send' AS action,'connector-runtime' AS audience,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 6106 AS id,'connector-runtime:identity' AS resource_code,'exchange' AS action,'connector-runtime' AS audience,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 6107 AS id,'connector-runtime:identity:dingtalk' AS resource_code,'exchange' AS action,'connector-runtime' AS audience,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 6108 AS id,'connector-runtime:people' AS resource_code,'sync' AS action,'connector-runtime' AS audience,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 6109 AS id,'connector-runtime:jobs' AS resource_code,'view' AS action,'connector-runtime' AS audience,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 6110 AS id,'connector-runtime:diagnostics' AS resource_code,'view' AS action,'connector-runtime' AS audience,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 6326 AS id,'connector-runtime:jobs' AS resource_code,'cancel' AS action,'connector-runtime' AS audience,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13038 AS id,'console:org-profile' AS resource_code,'view' AS action,'data-runtime' AS audience,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13039 AS id,'console:org-profile' AS resource_code,'edit' AS action,'data-runtime' AS audience,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13040 AS id,'console:system-setting' AS resource_code,'view' AS action,'data-runtime' AS audience,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13041 AS id,'console:system-setting' AS resource_code,'edit' AS action,'data-runtime' AS audience,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13042 AS id,'console:system-setting' AS resource_code,'manage' AS action,'data-runtime' AS audience,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13043 AS id,'console:business-domain' AS resource_code,'view' AS action,'data-runtime' AS audience,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13044 AS id,'console:business-domain' AS resource_code,'edit' AS action,'data-runtime' AS audience,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13045 AS id,'console:region' AS resource_code,'view' AS action,'data-runtime' AS audience,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13046 AS id,'console:region' AS resource_code,'edit' AS action,'data-runtime' AS audience,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13047 AS id,'console:work-calendar' AS resource_code,'view' AS action,'data-runtime' AS audience,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13048 AS id,'console:work-calendar' AS resource_code,'edit' AS action,'data-runtime' AS audience,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13049 AS id,'console:work-calendar' AS resource_code,'import' AS action,'data-runtime' AS audience,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13050 AS id,'console:audit' AS resource_code,'view' AS action,'data-runtime' AS audience,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13051 AS id,'console:audit' AS resource_code,'write' AS action,'data-runtime' AS audience,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13052 AS id,'console:notification' AS resource_code,'read' AS action,'data-runtime' AS audience,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13053 AS id,'console:notification' AS resource_code,'manage' AS action,'data-runtime' AS audience,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13054 AS id,'console:notification' AS resource_code,'publish' AS action,'data-runtime' AS audience,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13055 AS id,'console:directory-user' AS resource_code,'view' AS action,'data-runtime' AS audience,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13056 AS id,'console:directory-user' AS resource_code,'edit' AS action,'data-runtime' AS audience,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13057 AS id,'console:directory-profile' AS resource_code,'edit' AS action,'data-runtime' AS audience,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13058 AS id,'console:directory-department' AS resource_code,'view' AS action,'data-runtime' AS audience,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13059 AS id,'console:directory-department' AS resource_code,'edit' AS action,'data-runtime' AS audience,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13060 AS id,'console:directory-project' AS resource_code,'view' AS action,'data-runtime' AS audience,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13061 AS id,'console:directory-project' AS resource_code,'edit' AS action,'data-runtime' AS audience,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13062 AS id,'console:directory-sync' AS resource_code,'export' AS action,'data-runtime' AS audience,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13063 AS id,'console:directory-sync' AS resource_code,'view' AS action,'data-runtime' AS audience,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13064 AS id,'console:directory-sync' AS resource_code,'edit' AS action,'data-runtime' AS audience,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13065 AS id,'console:directory-connector' AS resource_code,'view' AS action,'data-runtime' AS audience,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13066 AS id,'console:directory-connector' AS resource_code,'execute' AS action,'data-runtime' AS audience,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13067 AS id,'console:directory-connector' AS resource_code,'enroll' AS action,'data-runtime' AS audience,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13068 AS id,'console:directory-source' AS resource_code,'view' AS action,'data-runtime' AS audience,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13069 AS id,'console:directory-source' AS resource_code,'edit' AS action,'data-runtime' AS audience,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13070 AS id,'console:connector-runtime' AS resource_code,'view' AS action,'data-runtime' AS audience,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13071 AS id,'console:connector-runtime' AS resource_code,'admin' AS action,'data-runtime' AS audience,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13072 AS id,'console:connector-runtime' AS resource_code,'enroll' AS action,'data-runtime' AS audience,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13073 AS id,'console:connector-runtime' AS resource_code,'heartbeat' AS action,'data-runtime' AS audience,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13074 AS id,'console:integration' AS resource_code,'view' AS action,'data-runtime' AS audience,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13075 AS id,'console:integration' AS resource_code,'edit' AS action,'data-runtime' AS audience,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13076 AS id,'console:integration' AS resource_code,'rotate' AS action,'data-runtime' AS audience,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13077 AS id,'console:integration' AS resource_code,'test' AS action,'data-runtime' AS audience,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13078 AS id,'console:avatar-object' AS resource_code,'read' AS action,'data-runtime' AS audience,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13079 AS id,'console:avatar-object' AS resource_code,'write' AS action,'data-runtime' AS audience,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13080 AS id,'console:auth-external-login' AS resource_code,'write' AS action,'data-runtime' AS audience,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13081 AS id,'console:auth-client' AS resource_code,'sync' AS action,'data-runtime' AS audience,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13082 AS id,'console:auth-health' AS resource_code,'view' AS action,'data-runtime' AS audience,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13083 AS id,'console:auth-identity' AS resource_code,'write' AS action,'data-runtime' AS audience,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13084 AS id,'console:auth-session' AS resource_code,'read' AS action,'data-runtime' AS audience,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13085 AS id,'console:auth-session' AS resource_code,'write' AS action,'data-runtime' AS audience,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13086 AS id,'console:auth-oidc' AS resource_code,'read' AS action,'data-runtime' AS audience,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13087 AS id,'console:auth-oidc' AS resource_code,'write' AS action,'data-runtime' AS audience,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13088 AS id,'console:auth-oidc' AS resource_code,'sign' AS action,'data-runtime' AS audience,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13089 AS id,'console:service-token' AS resource_code,'issue' AS action,'data-runtime' AS audience,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13090 AS id,'console:service-client' AS resource_code,'consume' AS action,'data-runtime' AS audience,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13091 AS id,'console:runtime-compat' AS resource_code,'read' AS action,'data-runtime' AS audience,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13092 AS id,'console:runtime-compat' AS resource_code,'manage' AS action,'data-runtime' AS audience,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13093 AS id,'console:platform-lifecycle' AS resource_code,'view' AS action,'data-runtime' AS audience,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13094 AS id,'console:platform-lifecycle' AS resource_code,'execute' AS action,'data-runtime' AS audience,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13095 AS id,'console:vault-secret' AS resource_code,'view' AS action,'data-runtime' AS audience,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13096 AS id,'console:vault-secret' AS resource_code,'edit' AS action,'data-runtime' AS audience,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13097 AS id,'console:vault-secret' AS resource_code,'reveal' AS action,'data-runtime' AS audience,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13098 AS id,'console:directory-employment' AS resource_code,'sync' AS action,'data-runtime' AS audience,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 13099 AS id,'console:directory-offboarding' AS resource_code,'disable' AS action,'data-runtime' AS audience,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 102384 AS id,'console:cutover-disposition' AS resource_code,'view' AS action,'data-runtime' AS audience,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 102385 AS id,'console:cutover-disposition' AS resource_code,'manage' AS action,'data-runtime' AS audience,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 102386 AS id,'console:cutover-service-client' AS resource_code,'retire' AS action,'data-runtime' AS audience,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 10190326 AS id,'console:directory-profiles' AS resource_code,'sync' AS action,'data-runtime' AS audience,'{"source": "tenant-runtime-bootstrap"}' AS old_json
      UNION ALL SELECT 46512766 AS id,'console:service-client' AS resource_code,'grant' AS action,'data-runtime' AS audience,'{"source": "tenant-runtime-bootstrap"}' AS old_json
  ) x;
SET @expected = (SELECT COUNT(*) FROM b17_audience_facts);
SET @ready = (SELECT COUNT(*) FROM b17_audience_facts f JOIN service_client_grants g ON g.id=f.id AND g.service_client_id=@cid
  AND g.resource_code=f.resource_code AND g.action=f.action AND g.status='active' AND CAST(g.scope_json AS CHAR)=f.old_json);
START TRANSACTION;
UPDATE service_client_grants g JOIN b17_audience_facts f ON g.id=f.id AND g.service_client_id=@cid
  AND g.resource_code=f.resource_code AND g.action=f.action AND g.status='active' AND CAST(g.scope_json AS CHAR)=f.old_json
SET g.scope_json = JSON_SET(g.scope_json,'$.audience',f.audience,'$.semanticScope',CONCAT(f.resource_code,':',f.action),'$.audienceFacts','s4-b17-audience-facts'),
    g.updated_at = UTC_TIMESTAMP()
WHERE @cid IS NOT NULL AND @expected = 86 AND @ready = 86;
COMMIT;
SELECT @expected AS expected, @ready AS ready,
  (SELECT COUNT(*) FROM service_client_grants WHERE service_client_id=@cid AND JSON_UNQUOTE(JSON_EXTRACT(scope_json,'$.audienceFacts'))='s4-b17-audience-facts') AS applied;
DROP TEMPORARY TABLE IF EXISTS b17_audience_facts;
