-- Console SQL Verify v1.97: Workflow purpose-bound subject eligibility grant.
-- Expected: one active credential-backed workflow.runtime row and
-- has_subject_eligibility = 1.

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

SELECT
  sc.`client_code`,
  sc.`app_code`,
  sc.`status` AS `client_status`,
  scc.`client_id`,
  scc.`status` AS `credential_status`,
  MAX(
    scg.`resource_code` = 'console:authorization'
    AND scg.`action` = 'subject-eligibility'
    AND scg.`status` = 'active'
    AND JSON_UNQUOTE(JSON_EXTRACT(scg.`scope_json`, '$.semanticScope')) = 'console:authorization:subject-eligibility'
    AND JSON_UNQUOTE(JSON_EXTRACT(scg.`scope_json`, '$.audience')) = 'console'
    AND JSON_CONTAINS(scg.`scope_json`, JSON_QUOTE('task_approve'), '$.registeredPurposes')
    AND JSON_CONTAINS(scg.`scope_json`, JSON_QUOTE('task_reject'), '$.registeredPurposes')
    AND JSON_CONTAINS(scg.`scope_json`, JSON_QUOTE('task_delegate'), '$.registeredPurposes')
    AND JSON_CONTAINS(scg.`scope_json`, JSON_QUOTE('instance_cancel'), '$.registeredPurposes')
    AND JSON_CONTAINS(scg.`scope_json`, JSON_QUOTE('instance_resubmit'), '$.registeredPurposes')
  ) AS `has_subject_eligibility`
FROM `service_clients` sc
LEFT JOIN `service_client_credentials` scc ON scc.`id` = sc.`current_credential_id`
LEFT JOIN `service_client_grants` scg ON scg.`service_client_id` = sc.`id`
WHERE sc.`app_code` = 'workflow' AND sc.`client_code` = 'workflow.runtime'
GROUP BY sc.`client_code`, sc.`app_code`, sc.`status`, scc.`client_id`, scc.`status`
ORDER BY sc.`client_code`;
