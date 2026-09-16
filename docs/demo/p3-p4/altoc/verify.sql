-- Execute against the configured Altoc database.
SET NAMES utf8mb4;

SELECT 'precondition' AS phase, 'altoc.customer_contract' AS check_code,
       IF(COUNT(*) = 1, 'PASS', 'FAIL') AS status,
       '1 active customer with effective contract' AS expected, CAST(COUNT(*) AS CHAR) AS actual,
       COALESCE(MAX(CONCAT(c.code, '|', c.status, '|', ct.code, '|', ct.status)), 'missing') AS evidence
FROM customer c
INNER JOIN contract ct ON ct.customer_id = c.id
WHERE c.code = 'DEMO-P3P4-202607-CUST' AND c.status = 'active' AND c.deleted_at IS NULL
  AND ct.code = 'DEMO-P3P4-202607-CT' AND ct.status = 'effective' AND ct.deleted_at IS NULL
UNION ALL
SELECT 'precondition', 'altoc.service_agreement_coverage', IF(COUNT(*) = 1, 'PASS', 'FAIL'),
       '1 active resolved asset+environment coverage', CAST(COUNT(*) AS CHAR),
       COALESCE(MAX(CONCAT(sa.code, '|', cov.delivery_asset_code, '|', cov.environment_code, '|', cov.coverage_status)), 'missing')
FROM service_agreement sa
INNER JOIN service_agreement_coverage cov ON cov.service_agreement_id = sa.id
WHERE sa.code = 'DEMO-P3P4-202607-SA' AND sa.status = 'active' AND sa.deleted_at IS NULL
  AND cov.coverage_code = 'DEMO-P3P4-202607-COV'
  AND cov.resolution_status = 'resolved' AND cov.coverage_status = 'active' AND cov.deleted_at IS NULL
UNION ALL
SELECT 'precondition', 'altoc.sla_entitlement', IF(COUNT(*) = 1, 'PASS', 'FAIL'),
       '1 active SLA (60/480 minutes)', CAST(COUNT(*) AS CHAR),
       COALESCE(MAX(CONCAT(se.code, '|', se.response_minutes, '|', se.resolution_minutes, '|', se.status)), 'missing')
FROM service_entitlement se
WHERE se.code = 'DEMO-P3P4-202607-SE' AND se.status = 'active'
  AND se.response_minutes = 60 AND se.resolution_minutes = 480
UNION ALL
SELECT 'precondition', 'altoc.service_ticket_source', IF(COUNT(*) = 1, 'PASS', 'FAIL'),
       '1 open in-service ticket with stable cross-module refs', CAST(COUNT(*) AS CHAR),
       COALESCE(MAX(CONCAT(code, '|', project_code, '|', delivery_asset_code, '|', environment_code, '|', status)), 'missing')
FROM service_ticket
WHERE code = 'DEMO-P3P4-202607-ST' AND status IN ('open', 'accepted', 'processing', 'resolved', 'closed')
  AND entitlement_status = 'in_service'
  AND project_code = 'DEMO-P3P4-202607-PROJ'
  AND delivery_asset_code = 'DEMO-P3P4-202607-CDA'
  AND environment_code = 'DEMO-P3P4-202607-ENV' AND deleted_at IS NULL
UNION ALL
SELECT 'precondition', 'altoc.renewal_opportunity', IF(COUNT(*) = 1, 'PASS', 'FAIL'),
       '1 open maintenance renewal', CAST(COUNT(*) AS CHAR),
       COALESCE(MAX(CONCAT(code, '|', renewal_type, '|', expected_amount, '|', status)), 'missing')
FROM renewal_opportunity
WHERE code = 'DEMO-P3P4-202607-RO' AND renewal_type = 'maintenance'
  AND status = 'open' AND deleted_at IS NULL
UNION ALL
SELECT 'e2e_result', 'altoc.aims_work_item_backref',
       IF(COUNT(*) = 1, 'PASS', 'FAIL'),
       'ticket has Aims project/work-item back-reference', CAST(COUNT(*) AS CHAR),
       COALESCE(MAX(CONCAT(code, '|', aims_project_code, '|', aims_work_item_key, '|', aims_work_item_type)),
                'run Altoc -> Aims work-item API')
FROM service_ticket
WHERE code = 'DEMO-P3P4-202607-ST'
  AND aims_project_code = 'DEMO-P3P4-202607-PROJ'
  AND aims_work_item_key IS NOT NULL AND aims_work_item_key <> ''
UNION ALL
SELECT 'e2e_result', 'altoc.delivery_result_and_document',
       IF(COUNT(*) = 1, 'PASS', 'FAIL'),
       'ticket resolved/closed with completed Codocs UUID reservation', CAST(COUNT(*) AS CHAR),
       COALESCE(MAX(CONCAT(code, '|', status, '|', resolved_at, '|', codocs_document_uuid, '|ops=', ops_knowledge_status)),
                'run Aims delivery-result sync and link ops document')
FROM service_ticket
WHERE code = 'DEMO-P3P4-202607-ST'
  AND status IN ('resolved', 'closed') AND resolved_at IS NOT NULL
  AND codocs_document_uuid = 'd3a4c000-2026-4701-8000-000000000001'
  AND ops_knowledge_pending_uuid IS NULL
  AND ops_knowledge_status = 'linked';
