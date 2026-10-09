-- Execute against the configured Codocs database.
SET NAMES utf8mb4;
START TRANSACTION;

INSERT INTO documents (
  uuid, title, doc_type, oss_path, owner_uid, dept_code, project_code,
  star_flag, home_flag, readonly_flag, ai_abstract, status,
  content_size, last_editor_uid, oss_commit_id, committed_at, deleted_at
) VALUES (
  'd3a4c000-2026-4701-8000-000000000001',
  'DEMO-P3P4-202607 运维知识与故障复盘', 'knowledge',
  'demo/p3-p4/202607/d3a4c000-2026-4701-8000-000000000001.md',
  'DEMO-P3P4-202607-EMP', 'DEMO-P3P4-202607-DEPT', 'DEMO-P3P4-202607-PROJ',
  0, 0, 0, 'DEMO-P3P4-202607 运维知识演示文档，仅存元数据和稳定引用。',
  1, 0, 'DEMO-P3P4-202607-EMP', 'DEMO-P3P4-202607-COMMIT',
  '2026-07-20 16:30:00', NULL
)
ON DUPLICATE KEY UPDATE
  title = VALUES(title),
  doc_type = VALUES(doc_type),
  oss_path = VALUES(oss_path),
  owner_uid = VALUES(owner_uid),
  dept_code = VALUES(dept_code),
  project_code = VALUES(project_code),
  ai_abstract = VALUES(ai_abstract),
  status = 1,
  last_editor_uid = VALUES(last_editor_uid),
  oss_commit_id = VALUES(oss_commit_id),
  committed_at = VALUES(committed_at),
  deleted_at = NULL;

COMMIT;
