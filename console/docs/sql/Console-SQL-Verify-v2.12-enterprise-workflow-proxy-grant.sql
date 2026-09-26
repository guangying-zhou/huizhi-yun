-- Expect exactly one active credential-backed Enterprise Host grant.
-- Workflow runtime identity and its Directory/Runtime grants are independent
-- prerequisites and must be verified before the local process starts.
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
SELECT sc.client_code,sc.app_code,sc.status AS client_status,
 scc.status AS credential_status,
 COUNT(scg.id) AS exact_rows,
 SUM(scg.status='active' AND JSON_UNQUOTE(JSON_EXTRACT(scg.scope_json,'$.audience'))='workflow'
     AND JSON_UNQUOTE(JSON_EXTRACT(scg.scope_json,'$.semanticScope'))='workflow:proxy') AS active_exact_rows
FROM service_clients sc
LEFT JOIN service_client_credentials scc ON scc.id=sc.current_credential_id
LEFT JOIN service_client_grants scg ON scg.service_client_id=sc.id
  AND scg.resource_code='workflow' AND scg.action='proxy'
WHERE sc.client_code='enterprise.runtime' AND sc.app_code='enterprise'
GROUP BY sc.id,sc.client_code,sc.app_code,sc.status,scc.status;
