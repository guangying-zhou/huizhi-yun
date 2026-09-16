-- Console SQL Verify v2.2: People DingTalk HR source Runtime grants.
SELECT sc.client_code,sc.app_code,g.resource_code,g.action,g.status,
       JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.audience')) audience,
       JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.semanticScope')) semantic_scope
FROM service_clients sc
INNER JOIN service_client_grants g ON g.service_client_id=sc.id
WHERE sc.status='active'
  AND g.status='active'
  AND g.resource_code IN (
    'data-runtime:people:hr-source-department-remap',
    'tenant-runtime:people:hr-source-department-remap'
  )
  AND g.action='execute'
ORDER BY g.resource_code;

SELECT COUNT(*) canonical_active_grants
FROM service_clients sc
INNER JOIN service_client_grants g ON g.service_client_id=sc.id
WHERE sc.status='active'
  AND sc.app_code='people'
  AND sc.client_code='people.runtime'
  AND g.status='active'
  AND g.resource_code IN (
    'data-runtime:people:hr-source-department-remap',
    'tenant-runtime:people:hr-source-department-remap'
  )
  AND g.action='execute';

SELECT COUNT(*) invalid_active_grants
FROM service_clients sc
INNER JOIN service_client_grants g ON g.service_client_id=sc.id
WHERE g.status='active'
  AND g.action='execute'
  AND (
    g.resource_code='people:hr-source-department-remap'
    OR (
      g.resource_code IN (
        'data-runtime:people:hr-source-department-remap',
        'tenant-runtime:people:hr-source-department-remap'
      )
      AND NOT (sc.app_code='people' AND sc.client_code='people.runtime')
    )
  );
