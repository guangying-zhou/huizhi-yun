-- Console SQL Verify v1.51: Codocs -> Workflow publish-request receipt grant.
-- Read-only; generated only and not executed by repository automation.
SELECT sc.client_code, sc.app_code, sc.status AS client_status,
       scg.resource_code, scg.action, scg.status AS grant_status
FROM service_clients sc
LEFT JOIN service_client_grants scg
  ON scg.service_client_id=sc.id
 AND scg.resource_code='workflow:document-publish'
 AND scg.action='create'
WHERE sc.status='active' AND (sc.app_code='codocs' OR sc.client_code IN ('codocs','codocs.runtime'));
