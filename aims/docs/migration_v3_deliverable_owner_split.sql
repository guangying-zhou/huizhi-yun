-- =====================================================================
-- Migration: deliverables 归属模型拆分
-- 从 work_item_owner_id (+ tier 判断) 拆成 target_id / matter_id
-- 并取消 source_deliverable_id（由 (target_id, matter_id) 同行承载）
-- =====================================================================
-- 执行前建议备份 hzy_aims.deliverables 表
-- 执行顺序: 1. 加列 2. 回填 3. 合并 source 副本 4. 删旧列/约束 5. 建新约束
-- =====================================================================

-- 1. 新增 target_id / matter_id 列
ALTER TABLE deliverables
  ADD COLUMN target_id BIGINT UNSIGNED NULL COMMENT '所属目标(target work_item)' AFTER work_item_owner_id,
  ADD COLUMN matter_id BIGINT UNSIGNED NULL COMMENT '承接执行的任务(matter work_item)' AFTER target_id;

-- 2. 按 work_items.tier 回填 target_id / matter_id
UPDATE deliverables d
JOIN work_items wi ON wi.id = d.work_item_owner_id
SET d.target_id = d.work_item_owner_id
WHERE wi.tier = 'target';

UPDATE deliverables d
JOIN work_items wi ON wi.id = d.work_item_owner_id
SET d.matter_id = d.work_item_owner_id
WHERE wi.tier = 'matter';

-- 3. 合并 source_deliverable_id 副本：matter 承接 target 成果的，把 matter_id
--    与提交状态/证据上行到 target 行，然后删除 matter 副本
UPDATE deliverables tgt
JOIN deliverables mtr ON mtr.source_deliverable_id = tgt.id
SET
  tgt.matter_id = mtr.matter_id,
  tgt.status = CASE WHEN mtr.status <> 'pending' THEN mtr.status ELSE tgt.status END,
  tgt.evidence_url = COALESCE(mtr.evidence_url, tgt.evidence_url),
  tgt.evidence_note = COALESCE(mtr.evidence_note, tgt.evidence_note),
  tgt.document_uuid = COALESCE(mtr.document_uuid, tgt.document_uuid),
  tgt.document_title = COALESCE(mtr.document_title, tgt.document_title),
  tgt.submitted_by = COALESCE(mtr.submitted_by, tgt.submitted_by),
  tgt.submitted_at = COALESCE(mtr.submitted_at, tgt.submitted_at);

DELETE FROM deliverables WHERE source_deliverable_id IS NOT NULL;

-- 4. 删除旧的 FK / CHECK / INDEX / COLUMN
ALTER TABLE deliverables
  DROP FOREIGN KEY fk_deliverable_source,
  DROP FOREIGN KEY fk_deliverable_work_item_owner,
  DROP CHECK chk_deliverable_single_owner;

ALTER TABLE deliverables
  DROP INDEX idx_deliverable_source,
  DROP INDEX idx_deliverable_work_item_owner,
  DROP COLUMN source_deliverable_id,
  DROP COLUMN work_item_owner_id;

-- 5. 新的索引 + FK + CHECK 约束
ALTER TABLE deliverables
  ADD KEY idx_deliverable_target (project_id, target_id),
  ADD KEY idx_deliverable_matter (project_id, matter_id),
  ADD CONSTRAINT fk_deliverable_target
    FOREIGN KEY (project_id, target_id) REFERENCES work_items (project_id, id) ON DELETE CASCADE,
  ADD CONSTRAINT fk_deliverable_matter
    FOREIGN KEY (project_id, matter_id) REFERENCES work_items (project_id, id) ON DELETE CASCADE,
  ADD CONSTRAINT chk_deliverable_single_owner CHECK (
    (project_owner_id IS NOT NULL AND milestone_owner_id IS NULL
      AND target_id IS NULL AND matter_id IS NULL)
    OR (project_owner_id IS NULL AND milestone_owner_id IS NOT NULL
      AND target_id IS NULL AND matter_id IS NULL)
    OR (project_owner_id IS NULL AND milestone_owner_id IS NULL
      AND (target_id IS NOT NULL OR matter_id IS NOT NULL))
  );

-- =====================================================================
-- 注意：
-- (1) source_deliverable_id 为 NULL 的历史 matter 行（如测试项目 39 里的
--     deliverable 149）会被视为"中间产物"，target_id 留空。
--     如需并入同名 target 成果作为承接方，请先手工 UPDATE，示例：
--
--     UPDATE deliverables SET matter_id = 185 WHERE id = 138;
--     DELETE FROM deliverables WHERE id = 149;
--
-- (2) matter FK 设置为 ON DELETE CASCADE。若 matter 是某 target 成果的
--     承接者（同行 target_id IS NOT NULL），删除 matter 前应用层需先
--     `UPDATE deliverables SET matter_id = NULL WHERE matter_id = ? AND target_id IS NOT NULL`
--     以保留 target 的成果要求行；否则承接行会被级联删除。
-- =====================================================================
