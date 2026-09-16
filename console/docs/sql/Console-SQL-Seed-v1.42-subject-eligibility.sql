-- Console Seed v1.42: purpose-bound subject eligibility capability.
-- Secret-free and repeatable. It does not connect or enable any notification producer.

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
START TRANSACTION;

INSERT INTO `service_clients` (
  `client_code`,`client_name`,`client_type`,`app_code`,`description`,`status`,`created_at`,`updated_at`
) VALUES (
  'workflow.runtime','Workflow Runtime','runtime','workflow',
  'Workflow runtime notification eligibility service identity','active',UTC_TIMESTAMP(),UTC_TIMESTAMP()
)
ON DUPLICATE KEY UPDATE
  `client_name`=VALUES(`client_name`),
  `client_type`=VALUES(`client_type`),
  `app_code`=VALUES(`app_code`),
  `description`=VALUES(`description`),
  `status`='active',
  `updated_at`=UTC_TIMESTAMP();

INSERT INTO `service_client_grants` (
  `service_client_id`,`resource_code`,`action`,`scope_json`,`status`,`created_at`,`updated_at`
)
SELECT
  sc.`id`,
  'console:authorization',
  'subject-eligibility',
  JSON_OBJECT(
    'source','seed:v1.42',
    'purpose','purpose-bound-minimum-view-eligibility',
    'registeredPurposes',IF(
      sc.`app_code`='workflow',
      JSON_ARRAY('task_actionable','instance_actionable','instance_status'),
      JSON_ARRAY()
    ),
    'endpoints',JSON_ARRAY('/api/v1/console/service/authorization/subject-eligibility')
  ),
  'active',UTC_TIMESTAMP(),UTC_TIMESTAMP()
FROM `service_clients` sc
WHERE sc.`status`='active'
  AND sc.`app_code` IN ('aims','assets','people','workflow','finance','altoc')
ON DUPLICATE KEY UPDATE
  `scope_json`=VALUES(`scope_json`),
  `status`='active',
  `updated_at`=UTC_TIMESTAMP();

COMMIT;

SELECT sc.`client_code`,sc.`app_code`,scg.`resource_code`,scg.`action`,scg.`status`,scg.`scope_json`
FROM `service_clients` sc
JOIN `service_client_grants` scg ON scg.`service_client_id`=sc.`id`
WHERE sc.`app_code` IN ('aims','assets','people','workflow','finance','altoc')
  AND scg.`resource_code`='console:authorization'
  AND scg.`action`='subject-eligibility';
