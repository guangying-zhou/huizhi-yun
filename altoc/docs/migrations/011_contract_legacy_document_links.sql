-- ============================================================
-- Migration 011: Migrate legacy OA contract archive PDF links
-- ============================================================
-- Source: wizbizdb.wb_contract + wizbizdb.wb_archives_page
-- Target: hzy_altoc.document_link
--
-- This migration stores only the original PDF URL. It does not copy files.
-- Existing migrated links are identified by wizbizdb.wb_archives_page.ap_id
-- and can be safely re-run.

USE hzy_altoc;

DROP PROCEDURE IF EXISTS hzy_add_document_link_column_if_missing;
DROP PROCEDURE IF EXISTS hzy_add_document_link_index_if_missing;
DROP PROCEDURE IF EXISTS hzy_make_document_uuid_nullable_if_needed;

DELIMITER $$

CREATE PROCEDURE hzy_add_document_link_column_if_missing(
  IN p_column_name VARCHAR(64),
  IN p_column_def TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'document_link'
      AND column_name = p_column_name
  ) THEN
    SET @ddl = CONCAT('ALTER TABLE document_link ADD COLUMN ', p_column_def);
    PREPARE stmt FROM @ddl;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END$$

CREATE PROCEDURE hzy_add_document_link_index_if_missing(
  IN p_index_name VARCHAR(64),
  IN p_index_def TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'document_link'
      AND index_name = p_index_name
  ) THEN
    SET @ddl = CONCAT('ALTER TABLE document_link ADD ', p_index_def);
    PREPARE stmt FROM @ddl;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END$$

CREATE PROCEDURE hzy_make_document_uuid_nullable_if_needed()
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'document_link'
      AND column_name = 'document_uuid'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE document_link
      MODIFY COLUMN document_uuid CHAR(36) DEFAULT NULL COMMENT 'Codocs文档UUID，外部链接为空';
  END IF;
END$$

DELIMITER ;

CALL hzy_make_document_uuid_nullable_if_needed();
CALL hzy_add_document_link_column_if_missing('external_url', 'external_url VARCHAR(1000) DEFAULT NULL COMMENT ''外部文档URL'' AFTER document_uuid');
CALL hzy_add_document_link_column_if_missing('external_mime_type', 'external_mime_type VARCHAR(100) DEFAULT NULL COMMENT ''外部文档MIME类型'' AFTER external_url');
CALL hzy_add_document_link_column_if_missing('source_type', 'source_type VARCHAR(30) DEFAULT ''codocs'' COMMENT ''来源类型：codocs/external_url'' AFTER link_type');
CALL hzy_add_document_link_column_if_missing('legacy_source', 'legacy_source VARCHAR(50) DEFAULT NULL COMMENT ''迁移来源系统'' AFTER source_type');
CALL hzy_add_document_link_column_if_missing('legacy_id', 'legacy_id VARCHAR(100) DEFAULT NULL COMMENT ''迁移来源主键'' AFTER legacy_source');
CALL hzy_add_document_link_index_if_missing('uk_document_link_legacy', 'UNIQUE KEY uk_document_link_legacy (legacy_source, legacy_id)');
CALL hzy_add_document_link_index_if_missing('idx_source_type', 'INDEX idx_source_type (source_type)');

DROP PROCEDURE IF EXISTS hzy_add_document_link_column_if_missing;
DROP PROCEDURE IF EXISTS hzy_add_document_link_index_if_missing;
DROP PROCEDURE IF EXISTS hzy_make_document_uuid_nullable_if_needed;

INSERT INTO document_link (
  entity_type,
  entity_id,
  document_uuid,
  external_url,
  external_mime_type,
  document_title,
  link_type,
  source_type,
  legacy_source,
  legacy_id,
  created_by,
  created_at
)
SELECT
  'contract',
  c.id,
  NULL,
  TRIM(ap.ap_url),
  'application/pdf',
  CONCAT('合同扫描件-', COALESCE(NULLIF(TRIM(wc.contract_code), ''), wc.contract_id)),
  'legacy_contract_scan',
  'external_url',
  'wizbizdb.wb_archives_page',
  ap.ap_id,
  'system',
  COALESCE(ap.submit_date, ap.operate_time, NOW())
FROM wizbizdb.wb_contract wc
INNER JOIN wizbizdb.wb_archives_page ap
  ON ap.archives_id = wc.archives_id
INNER JOIN contract c
  ON c.code COLLATE utf8mb4_unicode_ci = CONCAT('CTMIG', wc.contract_id) COLLATE utf8mb4_unicode_ci
LEFT JOIN document_link existing
  ON existing.legacy_source COLLATE utf8mb4_unicode_ci = 'wizbizdb.wb_archives_page' COLLATE utf8mb4_unicode_ci
 AND existing.legacy_id COLLATE utf8mb4_unicode_ci = ap.ap_id COLLATE utf8mb4_unicode_ci
WHERE c.deleted_at IS NULL
  AND ap.ap_status = '0'
  AND ap.ap_name COLLATE utf8mb4_unicode_ci = '合同' COLLATE utf8mb4_unicode_ci
  AND ap.ap_type COLLATE utf8mb4_unicode_ci = 'pdf' COLLATE utf8mb4_unicode_ci
  AND TRIM(ap.ap_url) COLLATE utf8mb4_unicode_ci LIKE 'http%.pdf' COLLATE utf8mb4_unicode_ci
  AND existing.id IS NULL;

SELECT
  COUNT(*) AS migrated_legacy_contract_pdf_links
FROM document_link
WHERE entity_type = 'contract'
  AND source_type = 'external_url'
  AND link_type = 'legacy_contract_scan'
  AND legacy_source = 'wizbizdb.wb_archives_page';
