-- ============================================================
-- AIMS: 清理指定项目下的所有需求数据，以及通过需求创建的任务
-- 使用前请先确认 @project_id
-- ============================================================

SET @project_id := 40;

START TRANSACTION;

-- 1. 收集要删除的需求ID
DROP TEMPORARY TABLE IF EXISTS tmp_requirement_ids;
CREATE TEMPORARY TABLE tmp_requirement_ids (
  id BIGINT UNSIGNED PRIMARY KEY
) ENGINE=Memory;

INSERT INTO tmp_requirement_ids (id)
SELECT id
FROM requirement_items
WHERE project_id = @project_id;

-- 2. 收集通过需求创建的执行工作项
--    只删除：
--    - work_items.requirement_id 指向需求项的任务 / 变更任务 / matter
--    - 上述工作项的所有子任务
--    保留 requirement_items.work_item_id 指向的需求分解入口 target
DROP TEMPORARY TABLE IF EXISTS tmp_work_item_ids;
CREATE TEMPORARY TABLE tmp_work_item_ids (
  id BIGINT UNSIGNED PRIMARY KEY
) ENGINE=Memory;

DROP TEMPORARY TABLE IF EXISTS tmp_work_item_seed;
CREATE TEMPORARY TABLE tmp_work_item_seed (
  id BIGINT UNSIGNED PRIMARY KEY
) ENGINE=Memory;

INSERT IGNORE INTO tmp_work_item_seed (id)
SELECT DISTINCT wi.id
FROM work_items wi
INNER JOIN tmp_requirement_ids req ON req.id = wi.requirement_id;

INSERT IGNORE INTO tmp_work_item_ids (id)
WITH RECURSIVE work_item_tree AS (
  SELECT wi.id
  FROM work_items wi
  INNER JOIN tmp_work_item_seed t ON t.id = wi.id

  UNION DISTINCT

  SELECT child.id
  FROM work_items child
  INNER JOIN work_item_tree parent_tree ON parent_tree.id = child.parent_id
)
SELECT id
FROM work_item_tree;

-- 3. 删除不会级联清掉的 Git 提交关联
DELETE gc
FROM gitlab_commits gc
INNER JOIN tmp_work_item_ids t ON t.id = gc.work_item_id;

-- 4. 删除需求评审批次
DELETE FROM requirement_review_batches
WHERE project_id = @project_id;

-- 5. 删除需求章节关联
DELETE ric
FROM requirement_item_contents ric
INNER JOIN tmp_requirement_ids req ON req.id = ric.requirement_id;

-- 6. 删除需求版本
DELETE rv
FROM requirement_versions rv
INNER JOIN tmp_requirement_ids req ON req.id = rv.requirement_id;

-- 7. 删除通过需求创建的任务 / 变更任务 / 子任务
--    其余 comments / changelog / attachments / relations / deliverables /
--    project_documents / approval_records / time_entries / source_anchors
--    会通过外键级联删除
DELETE wi
FROM work_items wi
INNER JOIN tmp_work_item_ids t ON t.id = wi.id;

-- 8. 删除需求项
DELETE ri
FROM requirement_items ri
INNER JOIN tmp_requirement_ids req ON req.id = ri.id;

-- 9. 删除需求规格书章节
DELETE FROM requirement_contents
WHERE project_id = @project_id;

-- 10. 重置规格书导入状态
UPDATE project_documents
SET import_status = 'not_imported',
    heading_levels = NULL,
    import_mode = NULL,
    updated_at = NOW()
WHERE project_id = @project_id
  AND doc_category = 'requirement_spec';

COMMIT;

-- 可选：如果希望需求编号从 REQ-001 重新开始，可执行
-- UPDATE project_counters SET req_counter = 0 WHERE project_id = @project_id;

-- 可选检查：
-- SELECT COUNT(*) FROM requirement_items WHERE project_id = @project_id;
-- SELECT COUNT(*) FROM requirement_contents WHERE project_id = @project_id;
-- SELECT COUNT(*) FROM work_items WHERE project_id = @project_id AND (requirement_id IS NOT NULL OR type = 'requirement');
