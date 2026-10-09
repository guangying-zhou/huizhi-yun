-- Document catalog (document asset design DOC-07).
-- Design: docs/Document-Asset-DOC-05-06-Implementation-Spec.md §7.
--
-- Registers documents whose content lives outside the documents table:
-- repository files (git) and module-held content (module). Metadata only; the
-- content stays in the owning system and is authorized there.
--
-- CANDIDATE ONLY. Executing it is an environment write and needs approval for
-- the target environment. CREATE TABLE / CREATE VIEW run once: check first with
--   SHOW FULL TABLES LIKE 'document_catalog%';
-- There is no backfill here: after installation run the reconcile command
-- (data-runtime/cmd/hzy-document-catalog-reconcile, dry-run by default).
--
-- Independent Codocs database only. A Codocs domain inside a unified business
-- database would need its own installer subset and is out of scope.
--
-- The tables are structurally separate from documents: no existing Codocs
-- list, detail, search, statistics or write path reads them. They and the view
-- are for the registration package, the reconcile command and a later index.
CREATE TABLE document_catalog_entries (
  uuid CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tenant_code VARCHAR(100) COLLATE utf8mb4_bin NOT NULL,
  source_app VARCHAR(32) COLLATE utf8mb4_bin NOT NULL,
  source_kind VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  source_object_id VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,
  title VARCHAR(255) NOT NULL,
  owner_type ENUM('project','portfolio','product_line') NOT NULL,
  owner_code VARCHAR(100) COLLATE utf8mb4_bin NOT NULL,
  storage_type ENUM('git','module') NOT NULL,
  storage_locator JSON NOT NULL,
  storage_revision VARCHAR(128) COLLATE utf8mb4_bin NOT NULL DEFAULT '',
  content_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  status ENUM('active','inactive') NOT NULL DEFAULT 'active',
  row_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  registered_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (uuid),
  UNIQUE KEY uk_document_catalog_source (tenant_code, source_app, source_kind, source_object_id),
  KEY idx_document_catalog_owner (owner_type, owner_code, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE document_catalog_entry_versions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  entry_uuid CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  storage_revision VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,
  content_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  recorded_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_document_catalog_version (entry_uuid, storage_revision)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Read-only union for enumeration. The documents side exposes metadata columns
-- only and leaves out deleted and recycled rows. It does not depend on the
-- DOC-06a storage columns, so the two migrations can be installed in any order.
CREATE SQL SECURITY INVOKER VIEW document_catalog AS
SELECT
  CAST(d.uuid AS CHAR(36)) AS uuid,
  d.title AS title,
  'codocs' AS source_app,
  d.doc_type AS source_kind,
  CAST(d.id AS CHAR) AS source_object_id,
  'oss' AS storage_type,
  CASE WHEN d.status = 2 THEN 'published' ELSE 'active' END AS status,
  d.updated_at AS updated_at
FROM documents d
WHERE d.status IN (1, 2) AND d.deleted_at IS NULL
UNION ALL
SELECT
  e.uuid, e.title, e.source_app, e.source_kind, e.source_object_id,
  e.storage_type, e.status, e.updated_at
FROM document_catalog_entries e
WHERE e.status = 'active';
