-- Console SQL Verify v1.40: status only; never reads secret material.
SELECT sc.`client_code`, sc.`status` AS `client_status`, scg.`status` AS `grant_status`,
       CONCAT(scg.`resource_code`,':',scg.`action`) AS `scope`,
       CASE WHEN sc.`status`='active' AND scg.`status`='active'
                  AND CONCAT(scg.`resource_code`,':',scg.`action`)='altoc:notification-details:authorize'
            THEN 'PASS' ELSE 'FAIL_GRANT' END AS `verification_status`
FROM `service_clients` sc
LEFT JOIN `service_client_grants` scg ON scg.`service_client_id`=sc.`id`
 AND scg.`resource_code`='altoc:notification-details' AND scg.`action`='authorize'
WHERE sc.`client_code`='console.runtime';
