-- Execute against the configured Codocs database.
SET NAMES utf8mb4;
START TRANSACTION;

DELETE dr
FROM document_relations dr
INNER JOIN documents d ON d.id = dr.document_id AND d.uuid = dr.document_uuid
WHERE d.uuid = 'd3a4c000-2026-4701-8000-000000000001'
  AND d.title LIKE 'DEMO-P3P4-202607%'
  AND dr.relation_type = 'ops_knowledge'
  AND dr.source_id LIKE 'DEMO-P3P4-202607-%';

DELETE FROM documents
WHERE uuid = 'd3a4c000-2026-4701-8000-000000000001'
  AND title LIKE 'DEMO-P3P4-202607%'
  AND oss_path LIKE 'demo/p3-p4/202607/%';

COMMIT;
