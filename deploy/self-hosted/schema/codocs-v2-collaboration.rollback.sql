-- Rollback of the Codocs v2 snapshot + collaboration schema (candidate, NOT executed).
-- DDL in MySQL commits implicitly: there is no transactional rollback and a failed
-- statement leaves earlier ones applied. Take the full hzy_codocs backup first and
-- record @@server_uuid.
--
-- PRECONDITION (checked by the operator with the verify script's `rollback-precondition`
-- statement, and by test-codocs-v2-schema-mysql.mjs): heads, candidates, sessions and
-- v2_history are all 0, and every collaboration/snapshot flag is already off. Once any
-- document has generation > 0 its authoritative content is the head's object version, so
-- dropping these tables would silently revert it to the stale documents.oss_path mirror:
-- in that case DO NOT run this file; keep the schema, keep the flags off, and restore
-- from the backup only through the separate approved recovery path.
--
-- Statements are split on "-- name:" markers and run in this order.

-- name: drop-collaboration
DROP TABLE IF EXISTS document_collaboration_publications

-- name: drop-collaboration-participants
DROP TABLE IF EXISTS document_collaboration_participants

-- name: drop-collaboration-tickets
DROP TABLE IF EXISTS document_collaboration_tickets

-- name: drop-collaboration-sessions
DROP TABLE IF EXISTS document_collaboration_sessions

-- name: drop-snapshot-candidates
DROP TABLE IF EXISTS document_snapshot_candidates

-- name: drop-snapshot-heads
DROP TABLE IF EXISTS document_snapshot_heads

-- name: drop-object-key
ALTER TABLE document_versions DROP COLUMN object_key
