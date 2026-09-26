-- Expect one active exact data-runtime grant for enterprise.runtime.
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
SELECT sc.client_code,sc.app_code,sc.status AS client_status,
 scc.status AS credential_status,
 COUNT(scg.id) AS exact_rows,
 SUM(scg.status='active'
     AND JSON_UNQUOTE(JSON_EXTRACT(scg.scope_json,'$.audience'))='data-runtime'
     AND JSON_UNQUOTE(JSON_EXTRACT(scg.scope_json,'$.semanticScope'))='assets:ip-asset:link-product') AS active_exact_rows
FROM service_clients sc
LEFT JOIN service_client_credentials scc ON scc.id=sc.current_credential_id
LEFT JOIN service_client_grants scg ON scg.service_client_id=sc.id
  AND scg.resource_code='assets:ip-asset' AND scg.action='link-product'
WHERE sc.client_code='enterprise.runtime' AND sc.app_code='enterprise'
GROUP BY sc.id,sc.client_code,sc.app_code,sc.status,scc.status;
