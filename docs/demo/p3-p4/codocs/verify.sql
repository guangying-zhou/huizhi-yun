-- Execute against the configured Codocs database.
SET NAMES utf8mb4;

SELECT 'precondition' AS phase, 'codocs.ops_document' AS check_code,
       IF(COUNT(*) = 1, 'PASS', 'FAIL') AS status,
       '1 active knowledge document' AS expected, CAST(COUNT(*) AS CHAR) AS actual,
       COALESCE(MAX(CONCAT(uuid, '|', doc_type, '|', project_code, '|', status)), 'missing') AS evidence
FROM documents
WHERE uuid = 'd3a4c000-2026-4701-8000-000000000001'
  AND title LIKE 'DEMO-P3P4-202607%'
  AND doc_type = 'knowledge' AND status = 1 AND deleted_at IS NULL
UNION ALL
SELECT 'e2e_result', 'codocs.ops_knowledge_relations',
       IF(COUNT(DISTINCT CONCAT(dr.source_type, ':', dr.source_id)) = 6, 'PASS', 'FAIL'),
       '6 non-ACL context relations (ticket/delivery asset/environment/contract/project/customer)',
       CAST(COUNT(DISTINCT CONCAT(dr.source_type, ':', dr.source_id)) AS CHAR),
       COALESCE(GROUP_CONCAT(DISTINCT CONCAT(dr.source_type, ':', dr.source_id)
                             ORDER BY dr.source_type SEPARATOR ','),
                'run Altoc -> Codocs ops-knowledge link API')
FROM document_relations dr
INNER JOIN documents d ON d.id = dr.document_id AND d.uuid = dr.document_uuid
WHERE d.uuid = 'd3a4c000-2026-4701-8000-000000000001'
  AND dr.relation_type = 'ops_knowledge'
  AND dr.status = 1
  AND dr.related_uid = 'service:altoc:ops-knowledge'
  AND dr.can_read = 0 AND dr.can_edit = 0 AND dr.can_comment = 0
  AND (
    (dr.source_type = 'altoc_service_ticket' AND dr.source_id = 'DEMO-P3P4-202607-ST')
    OR (dr.source_type = 'assets_delivery_asset' AND dr.source_id = 'DEMO-P3P4-202607-CDA')
    OR (dr.source_type = 'assets_environment' AND dr.source_id = 'DEMO-P3P4-202607-ENV')
    OR (dr.source_type = 'altoc_contract' AND dr.source_id = 'DEMO-P3P4-202607-CT')
    OR (dr.source_type = 'aims_project' AND dr.source_id = 'DEMO-P3P4-202607-PROJ')
    OR (dr.source_type = 'altoc_customer' AND dr.source_id = 'DEMO-P3P4-202607-CUST')
  )
UNION ALL
SELECT 'e2e_result', 'codocs.ops_knowledge_acl_hardened',
       IF(COUNT(*) = 0, 'PASS', 'FAIL'),
       '0 active ops-knowledge context relations granting document ACL',
       CAST(COUNT(*) AS CHAR),
       CONCAT('unsafe_count=', COUNT(*))
FROM document_relations
WHERE relation_type = 'ops_knowledge'
  AND status = 1
  AND (can_read <> 0 OR can_edit <> 0 OR can_comment <> 0);
