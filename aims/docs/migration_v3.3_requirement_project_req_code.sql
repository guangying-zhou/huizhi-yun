-- Migration: v3.3 requirement project-prefixed req_code
-- 目标：需求显示编号从 REQ-001 调整为 PROJECT_CODE-REQ-001，以满足 req_code 全局唯一约束。

ALTER TABLE `requirement_items`
  MODIFY COLUMN `req_code` VARCHAR(100) NOT NULL COMMENT '全局唯一显示编号，如 HZY-REQ-001';

UPDATE `requirement_items` r
JOIN `aims_projects` p ON p.id = r.project_id
SET r.req_code = CONCAT(p.project_code, '-REQ-', LPAD(r.req_number, 3, '0'))
WHERE r.req_code NOT LIKE CONCAT(p.project_code, '-REQ-%');

UPDATE `project_counters` pc
JOIN (
  SELECT project_id, COALESCE(MAX(req_number), 0) AS max_req_number
  FROM `requirement_items`
  GROUP BY project_id
) t ON t.project_id = pc.project_id
SET pc.req_counter = GREATEST(pc.req_counter, t.max_req_number);
