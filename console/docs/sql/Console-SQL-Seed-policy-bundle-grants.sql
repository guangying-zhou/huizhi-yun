-- Execute only in the explicitly selected tenant Console database after enrollment.
-- console.runtime's issuer accepts these capabilities only for data-runtime and
-- tenant-runtime. One exact grant authorizes each action for both Runtime audiences.
-- Preserve disabled existing grants; investigate drift instead of reactivating it.
INSERT INTO service_client_grants
  (service_client_id,resource_code,action,scope_json,status,created_at,updated_at)
SELECT c.id,'console:policy-bundle',a.action,JSON_OBJECT('source','policy-bundle-install'),
  'active',UTC_TIMESTAMP(),UTC_TIMESTAMP()
FROM service_clients c
CROSS JOIN (SELECT 'read' AS action UNION ALL SELECT 'write') a
WHERE c.client_code='console.runtime' AND c.app_code='console' AND c.status='active'
  AND c.current_credential_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM service_client_grants g
    WHERE g.service_client_id=c.id AND g.resource_code='console:policy-bundle' AND g.action=a.action);

-- Must return active_grants=2. Also probe actual signed token issuance for BOTH
-- audiences with read, write and combined scopes before enabling the backend.
SELECT COUNT(*) AS active_grants FROM service_client_grants g
JOIN service_clients c ON c.id=g.service_client_id
WHERE c.client_code='console.runtime' AND c.app_code='console' AND c.status='active'
  AND g.resource_code='console:policy-bundle' AND g.action IN ('read','write') AND g.status='active';
