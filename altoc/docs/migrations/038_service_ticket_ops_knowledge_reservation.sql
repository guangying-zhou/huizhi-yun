-- Altoc migration 038: reserve service-ticket ops knowledge binding before
-- cross-application Codocs/Assets writes. This prevents two different document
-- UUIDs from both reaching downstream systems during concurrent requests.

SET @hzy_038_has_pending_uuid := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'service_ticket'
    AND COLUMN_NAME = 'ops_knowledge_pending_uuid'
);
SET @hzy_038_sql := IF(
  @hzy_038_has_pending_uuid = 0,
  'ALTER TABLE service_ticket ADD COLUMN ops_knowledge_pending_uuid VARCHAR(100) DEFAULT NULL COMMENT ''运维知识编排预留UUID；完成前阻止换绑'' AFTER codocs_document_uuid',
  'SELECT ''service_ticket.ops_knowledge_pending_uuid already exists'' AS msg'
);
PREPARE stmt FROM @hzy_038_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @hzy_038_has_status := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'service_ticket'
    AND COLUMN_NAME = 'ops_knowledge_status'
);
SET @hzy_038_sql := IF(
  @hzy_038_has_status = 0,
  'ALTER TABLE service_ticket ADD COLUMN ops_knowledge_status VARCHAR(20) NOT NULL DEFAULT ''idle'' COMMENT ''运维知识编排状态：idle/pending/linked'' AFTER ops_knowledge_pending_uuid',
  'SELECT ''service_ticket.ops_knowledge_status already exists'' AS msg'
);
PREPARE stmt FROM @hzy_038_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @hzy_038_has_idempotency := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'service_ticket'
    AND COLUMN_NAME = 'ops_knowledge_idempotency_key'
);
SET @hzy_038_sql := IF(
  @hzy_038_has_idempotency = 0,
  'ALTER TABLE service_ticket ADD COLUMN ops_knowledge_idempotency_key VARCHAR(191) DEFAULT NULL COMMENT ''运维知识编排幂等键'' AFTER ops_knowledge_status',
  'SELECT ''service_ticket.ops_knowledge_idempotency_key already exists'' AS msg'
);
PREPARE stmt FROM @hzy_038_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @hzy_038_has_index := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'service_ticket'
    AND INDEX_NAME = 'idx_ops_knowledge_pending'
);
SET @hzy_038_sql := IF(
  @hzy_038_has_index = 0,
  'CREATE INDEX idx_ops_knowledge_pending ON service_ticket (ops_knowledge_pending_uuid, ops_knowledge_status)',
  'SELECT ''service_ticket.idx_ops_knowledge_pending already exists'' AS msg'
);
PREPARE stmt FROM @hzy_038_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE service_ticket
SET ops_knowledge_status = CASE
      WHEN codocs_document_uuid IS NOT NULL AND codocs_document_uuid <> '' THEN 'linked'
      WHEN ops_knowledge_pending_uuid IS NOT NULL AND ops_knowledge_pending_uuid <> '' THEN 'pending'
      ELSE 'idle'
    END
WHERE deleted_at IS NULL;
