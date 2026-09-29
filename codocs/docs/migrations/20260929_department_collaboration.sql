-- Department document collaboration (Runtime batch R1). Extends the v2
-- collaboration tables from 20260924_document_collaboration_sessions.sql.
-- Design: docs/Codocs-Host-Department-Collaboration-Design.md (A-4).
--
-- DDL is not transactional: install after a full backup, and only together with
-- the department-collaboration Runtime build. The Runtime keeps working on a
-- database without these columns for private (personal) sessions, and keeps
-- apps.codocs.departmentCollaborationV2Enabled off until this is installed.
--
-- policy      : which authorization policy governs the session. 'private' keeps
--               the personal owner/share model (the opener's write access);
--               'department' re-verifies every connected participant against the
--               Directory relation (leader/parent never write).
-- dept_code   : the department the session was opened for; the Runtime never
--               accepts a department from Collab.
-- status      : per-participant lifecycle inside a session. 'left' = not reported
--               by the last renew; 'revoked' = failed the Directory/document check.
-- checked_at  : last time the Runtime re-verified the participant.
ALTER TABLE document_collaboration_sessions
  ADD COLUMN policy ENUM('private', 'department') NOT NULL DEFAULT 'private' AFTER opened_by,
  ADD COLUMN dept_code VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL AFTER policy,
  ADD CONSTRAINT collaboration_session_policy CHECK (
    (policy = 'private' AND dept_code IS NULL) OR (policy = 'department' AND dept_code IS NOT NULL)),
  ADD INDEX collaboration_session_document_only (document_uuid, status);

ALTER TABLE document_collaboration_participants
  ADD COLUMN status ENUM('active', 'left', 'revoked') NOT NULL DEFAULT 'active' AFTER access,
  ADD COLUMN checked_at DATETIME NULL AFTER last_admitted_at,
  ADD INDEX collaboration_participant_status (tenant_code, deployment_code, session_id, status);

-- invalidateCollaboration and the v2 guard look documents up by UUID alone.
-- Without this index those statements scan (and, under SERIALIZABLE, lock) the
-- whole heads table from the department write paths.
ALTER TABLE document_snapshot_heads
  ADD INDEX snapshot_head_document (document_uuid);
