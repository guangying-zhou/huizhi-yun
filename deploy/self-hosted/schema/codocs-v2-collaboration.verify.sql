-- Codocs v2 snapshot + collaboration schema: read-only verification (candidate,
-- NOT executed against any real database). Run on the hzy_codocs schema of the
-- restored copy (S3) and again on the final copy (M6) with a SELECT-only account.
-- Migrations: codocs/docs/migrations/20260920_document_snapshots.sql and
-- 20260924_document_collaboration_sessions.sql. Statements are split on
-- "-- name:" markers; each returns rows and changes nothing.

-- name: prerequisite-columns
-- Must return 3 rows before install: oss_version_id (v1 baseline), content_sha256 (v1.5,
-- also written by the collaboration version insert) and NO object_key yet.
SELECT column_name AS name FROM information_schema.columns
WHERE table_schema = DATABASE() AND table_name = 'document_versions'
  AND column_name IN ('oss_version_id', 'content_sha256', 'object_key')
ORDER BY column_name

-- name: tables
-- After install: exactly these 6 rows.
SELECT table_name AS name, engine FROM information_schema.tables
WHERE table_schema = DATABASE()
  AND table_name IN ('document_snapshot_heads', 'document_snapshot_candidates', 'document_collaboration_sessions',
    'document_collaboration_tickets', 'document_collaboration_participants', 'document_collaboration_publications')
ORDER BY table_name

-- name: object-key-column
-- After install: one row, VARCHAR(512) NULL, positioned right after oss_version_id.
SELECT column_name AS name, column_type AS type, is_nullable AS nullable FROM information_schema.columns
WHERE table_schema = DATABASE() AND table_name = 'document_versions' AND column_name = 'object_key'

-- name: primary-keys
-- After install: every table is keyed by (tenant_code, deployment_code, ...).
SELECT table_name AS name, GROUP_CONCAT(column_name ORDER BY seq_in_index) AS key_columns
FROM information_schema.statistics
WHERE table_schema = DATABASE() AND index_name = 'PRIMARY'
  AND table_name IN ('document_snapshot_heads', 'document_snapshot_candidates', 'document_collaboration_sessions',
    'document_collaboration_tickets', 'document_collaboration_participants', 'document_collaboration_publications')
GROUP BY table_name ORDER BY table_name

-- name: check-constraints
-- After install: snapshot_head_generation, snapshot_head_publication, snapshot_candidate_generation,
-- snapshot_candidate_publication, collaboration_session_epoch.
SELECT constraint_name AS name FROM information_schema.table_constraints
WHERE table_schema = DATABASE() AND constraint_type = 'CHECK'
  AND table_name IN ('document_snapshot_heads', 'document_snapshot_candidates', 'document_collaboration_sessions')
ORDER BY constraint_name

-- name: charset-collation
-- Tenant/deployment/candidate/session/user identifier columns (varchar/char) are byte-exact (utf8mb4_bin / ascii_bin);
-- must return 0 rows. ENUM columns follow the schema default and are not identifiers.
SELECT table_name AS name, column_name AS col, collation_name AS collation FROM information_schema.columns
WHERE table_schema = DATABASE() AND collation_name IS NOT NULL AND data_type IN ('varchar', 'char')
  AND table_name IN ('document_snapshot_heads', 'document_snapshot_candidates', 'document_collaboration_sessions',
    'document_collaboration_tickets', 'document_collaboration_participants', 'document_collaboration_publications')
  AND collation_name NOT IN ('utf8mb4_bin', 'ascii_bin')

-- name: rollback-precondition
-- Rollback is only permitted while ALL of these are 0 (no v2 document, session or history row exists).
SELECT
  (SELECT COUNT(*) FROM document_snapshot_heads) AS heads,
  (SELECT COUNT(*) FROM document_snapshot_candidates) AS candidates,
  (SELECT COUNT(*) FROM document_collaboration_sessions) AS sessions,
  (SELECT COUNT(*) FROM document_versions WHERE object_key IS NOT NULL) AS v2_history
