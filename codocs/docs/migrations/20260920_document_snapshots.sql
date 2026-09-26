-- Dormant v2 storage publication primitives. Do not install/activate until all
-- readers/writers, trusted storage verification and epoch management are wired.
-- Tenant runtime owns application DB binding. No migration of legacy objects.
CREATE TABLE document_snapshot_heads (
  tenant_code VARCHAR(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  deployment_code VARCHAR(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  document_uuid CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  generation BIGINT NOT NULL DEFAULT 0,
  collaboration_epoch BIGINT NOT NULL DEFAULT 0,
  published_candidate CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  objects_json JSON NULL,
  PRIMARY KEY (tenant_code, deployment_code, document_uuid),
  CONSTRAINT snapshot_head_generation CHECK (generation >= 0 AND collaboration_epoch >= 0),
  CONSTRAINT snapshot_head_publication CHECK (
    (generation = 0 AND published_candidate IS NULL AND objects_json IS NULL) OR
    (generation > 0 AND published_candidate IS NOT NULL AND objects_json IS NOT NULL))
) ENGINE=InnoDB;

CREATE TABLE document_snapshot_candidates (
  tenant_code VARCHAR(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  deployment_code VARCHAR(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  candidate_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  document_uuid CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  actor_uid VARCHAR(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  command_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  command_json JSON NOT NULL,
  expected_generation BIGINT NOT NULL,
  expected_epoch BIGINT NOT NULL,
  state ENUM('prepared', 'published') NOT NULL DEFAULT 'prepared',
  published_generation BIGINT NULL,
  objects_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published_at DATETIME NULL,
  PRIMARY KEY (tenant_code, deployment_code, candidate_key),
  INDEX snapshot_document_history (tenant_code, deployment_code, document_uuid),
  CONSTRAINT snapshot_candidate_generation CHECK (expected_generation >= 0 AND expected_epoch >= 0),
  CONSTRAINT snapshot_candidate_publication CHECK (
    (state = 'prepared' AND published_generation IS NULL AND objects_json IS NULL AND published_at IS NULL) OR
    (state = 'published' AND published_generation = expected_generation + 1 AND published_generation IS NOT NULL AND objects_json IS NOT NULL AND published_at IS NOT NULL))
) ENGINE=InnoDB;

-- v2 publications also add a history row whose content lives at object_key
-- (exact version oss_version_id) instead of documents.oss_path.
ALTER TABLE document_versions ADD COLUMN object_key VARCHAR(512) NULL AFTER oss_version_id;
