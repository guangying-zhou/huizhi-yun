-- Read-only verification for Console subject eligibility grants. Never prints credentials.
SELECT
  sc.`client_code`,sc.`app_code`,sc.`status` AS client_status,
  scc.`status` AS credential_status,
  scg.`status` AS grant_status,
  CONCAT(scg.`resource_code`,':',scg.`action`) AS capability,
  scg.`scope_json` AS grant_scope
FROM `service_clients` sc
LEFT JOIN `service_client_credentials` scc ON scc.`id`=sc.`current_credential_id`
LEFT JOIN `service_client_grants` scg
  ON scg.`service_client_id`=sc.`id`
 AND scg.`resource_code`='console:authorization'
 AND scg.`action`='subject-eligibility'
WHERE sc.`app_code` IN ('aims','assets','people','workflow','finance','altoc');
