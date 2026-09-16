-- Console SQL Verify v2.1: People DingTalk HR source grants.
SELECT sc.client_code,sc.app_code,g.resource_code,g.action,g.status,
       JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.purpose')) purpose
FROM service_clients sc
INNER JOIN service_client_grants g ON g.service_client_id=sc.id
WHERE sc.status='active'
  AND g.resource_code='console:hr-source-sync'
  AND (
    (sc.app_code='people' AND sc.client_code='people.runtime' AND g.action IN ('view','execute','admin'))
    OR
    (sc.app_code='console' AND sc.client_code='console.runtime' AND g.action IN ('view','admin'))
  )
ORDER BY sc.app_code,sc.client_code,g.action;

SELECT sc.client_code,sc.app_code,COUNT(*) active_grants
FROM service_clients sc
INNER JOIN service_client_grants g ON g.service_client_id=sc.id
WHERE sc.status='active' AND g.status='active' AND g.resource_code='console:hr-source-sync'
  AND ((sc.app_code='people' AND sc.client_code='people.runtime')
    OR (sc.app_code='console' AND sc.client_code='console.runtime'))
GROUP BY sc.id,sc.client_code,sc.app_code
HAVING COUNT(*) = CASE WHEN sc.app_code='people' AND sc.client_code='people.runtime' THEN 3 ELSE 2 END;

SELECT sc.client_code,sc.app_code,g.resource_code,g.action,g.status,
       JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.purpose')) purpose
FROM service_clients sc
INNER JOIN service_client_grants g ON g.service_client_id=sc.id
WHERE sc.status='active'
  AND g.status='active'
  AND g.resource_code='people:hr-source-department-remap'
  AND g.action='execute'
  AND sc.app_code='people'
  AND sc.client_code='people.runtime'
ORDER BY sc.app_code,sc.client_code;

SELECT COUNT(*) noncanonical_active_grants
FROM service_clients sc
INNER JOIN service_client_grants g ON g.service_client_id=sc.id
WHERE g.status='active'
  AND (
    (g.resource_code='console:hr-source-sync' AND NOT (
      (sc.app_code='people' AND sc.client_code='people.runtime')
      OR (sc.app_code='console' AND sc.client_code='console.runtime')
    ))
    OR
    (g.resource_code='people:hr-source-department-remap'
      AND NOT (sc.app_code='people' AND sc.client_code='people.runtime'))
  );
