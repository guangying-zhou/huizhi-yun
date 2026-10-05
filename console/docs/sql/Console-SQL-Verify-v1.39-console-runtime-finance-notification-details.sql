-- Console SQL Verify v1.39: identifiers/status only; never reads secret material.
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

SELECT sc.`client_code`, sc.`status` AS `client_status`, scg.`status` AS `grant_status`,
       CONCAT(scg.`resource_code`,':',scg.`action`) AS `scope`,
       CASE WHEN sc.`status`='active' AND scg.`status`='active'
                  AND CONCAT(scg.`resource_code`,':',scg.`action`)='finance:notification-details:authorize'
            THEN 'PASS' ELSE 'FAIL_GRANT' END AS `verification_status`
FROM `service_clients` sc
LEFT JOIN `service_client_grants` scg ON scg.`service_client_id`=sc.`id`
 AND scg.`resource_code`='finance:notification-details' AND scg.`action`='authorize'
WHERE sc.`client_code`='console.runtime';
