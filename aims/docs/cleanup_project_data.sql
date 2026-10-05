-- ============================================================
-- AIMS: 按 project_id 清理整个项目及其关联数据
-- 目标库: hzy_aims
-- 使用说明:
--   1. 执行前先确认 @project_id
--   2. 默认直接 COMMIT；如需演练，请把最后一行改成 ROLLBACK
--   3. 该脚本会删除项目主表 aims_projects 记录，以及所有 project_id 关联数据
--   4. 不会删除共享基础数据：project_portfolios / project_template_sets / project_template_versions
-- ============================================================

USE `hzy_aims`;

SET @project_id := 37;

START TRANSACTION;

DROP TEMPORARY TABLE IF EXISTS `tmp_project_ids`;
CREATE TEMPORARY TABLE `tmp_project_ids` (
  `project_id` BIGINT UNSIGNED NOT NULL PRIMARY KEY
) ENGINE=Memory;

INSERT INTO `tmp_project_ids` (`project_id`)
SELECT `id`
FROM `aims_projects`
WHERE `id` = @project_id;

DROP TEMPORARY TABLE IF EXISTS `tmp_milestone_ids`;
CREATE TEMPORARY TABLE `tmp_milestone_ids` (
  `milestone_id` BIGINT UNSIGNED NOT NULL PRIMARY KEY
) ENGINE=Memory;

INSERT INTO `tmp_milestone_ids` (`milestone_id`)
SELECT `id`
FROM `milestones`
WHERE `project_id` IN (
  SELECT `project_id` FROM `tmp_project_ids`
);

DROP TEMPORARY TABLE IF EXISTS `tmp_work_item_ids`;
CREATE TEMPORARY TABLE `tmp_work_item_ids` (
  `work_item_id` BIGINT UNSIGNED NOT NULL PRIMARY KEY
) ENGINE=Memory;

INSERT INTO `tmp_work_item_ids` (`work_item_id`)
SELECT `id`
FROM `work_items`
WHERE `project_id` IN (
  SELECT `project_id` FROM `tmp_project_ids`
);

DROP TEMPORARY TABLE IF EXISTS `tmp_requirement_ids`;
CREATE TEMPORARY TABLE `tmp_requirement_ids` (
  `requirement_id` BIGINT UNSIGNED NOT NULL PRIMARY KEY
) ENGINE=Memory;

INSERT INTO `tmp_requirement_ids` (`requirement_id`)
SELECT `id`
FROM `requirement_items`
WHERE `project_id` IN (
  SELECT `project_id` FROM `tmp_project_ids`
);

SELECT
  p.`id` AS `project_id`,
  p.`project_code`,
  p.`name`,
  p.`lifecycle_status`,
  p.`created_at`,
  p.`updated_at`
FROM `aims_projects` p
WHERE p.`id` = @project_id;

SELECT
  (SELECT COUNT(*) FROM `tmp_project_ids`) AS `projects`,
  (SELECT COUNT(*) FROM `tmp_milestone_ids`) AS `milestones`,
  (SELECT COUNT(*) FROM `tmp_work_item_ids`) AS `work_items`,
  (SELECT COUNT(*) FROM `tmp_requirement_ids`) AS `requirements`;

-- ============================================================
-- 1. 先删无强外键或多 owner 聚合表，避免后续主实体删除被阻塞
-- ============================================================

DELETE FROM `deliverables`
WHERE `project_id` IN (
  SELECT `project_id` FROM `tmp_project_ids`
);

DELETE FROM `deliverables`
WHERE `project_owner_id` IN (
  SELECT `project_id` FROM `tmp_project_ids`
);

DELETE FROM `deliverables`
WHERE `milestone_owner_id` IN (
  SELECT `milestone_id` FROM `tmp_milestone_ids`
);

DELETE FROM `deliverables`
WHERE `target_id` IN (
  SELECT `work_item_id` FROM `tmp_work_item_ids`
);

DELETE FROM `deliverables`
WHERE `matter_id` IN (
  SELECT `work_item_id` FROM `tmp_work_item_ids`
);

DELETE FROM `approval_records`
WHERE `project_id` IN (
  SELECT `project_id` FROM `tmp_project_ids`
);

DELETE FROM `approval_records`
WHERE `project_owner_id` IN (
  SELECT `project_id` FROM `tmp_project_ids`
);

DELETE FROM `approval_records`
WHERE `milestone_owner_id` IN (
  SELECT `milestone_id` FROM `tmp_milestone_ids`
);

DELETE FROM `approval_records`
WHERE `work_item_owner_id` IN (
  SELECT `work_item_id` FROM `tmp_work_item_ids`
);

-- ============================================================
-- 2. 工作项子表 / 文档 / 通知 / 收藏 / 仓库关联等
-- ============================================================

DELETE FROM `time_entries`
WHERE `work_item_id` IN (
  SELECT `work_item_id` FROM `tmp_work_item_ids`
);

DELETE FROM `work_item_source_anchors`
WHERE `work_item_id` IN (
  SELECT `work_item_id` FROM `tmp_work_item_ids`
);

DELETE FROM `work_item_attachments`
WHERE `work_item_id` IN (
  SELECT `work_item_id` FROM `tmp_work_item_ids`
);

DELETE FROM `work_item_changelog`
WHERE `work_item_id` IN (
  SELECT `work_item_id` FROM `tmp_work_item_ids`
);

DELETE FROM `work_item_comments`
WHERE `work_item_id` IN (
  SELECT `work_item_id` FROM `tmp_work_item_ids`
);

DELETE FROM `work_item_relations`
WHERE `source_id` IN (
  SELECT `work_item_id` FROM `tmp_work_item_ids`
);

DELETE FROM `work_item_relations`
WHERE `target_id` IN (
  SELECT `work_item_id` FROM `tmp_work_item_ids`
);

DELETE FROM `project_documents`
WHERE `project_id` IN (
  SELECT `project_id` FROM `tmp_project_ids`
)
OR `milestone_id` IN (
  SELECT `milestone_id` FROM `tmp_milestone_ids`
)
OR `work_item_id` IN (
  SELECT `work_item_id` FROM `tmp_work_item_ids`
);

DELETE FROM `gitlab_commits`
WHERE `project_id` IN (
  SELECT `project_id` FROM `tmp_project_ids`
)
OR `work_item_id` IN (
  SELECT `work_item_id` FROM `tmp_work_item_ids`
);

DELETE FROM `notification_rules`
WHERE `project_id` IN (
  SELECT `project_id` FROM `tmp_project_ids`
);

DELETE FROM `workflow_transitions`
WHERE `project_id` IN (
  SELECT `project_id` FROM `tmp_project_ids`
);

DELETE FROM `user_favorite_projects`
WHERE `project_id` IN (
  SELECT `project_id` FROM `tmp_project_ids`
);

DELETE FROM `aims_project_repos`
WHERE `project_id` IN (
  SELECT `project_id` FROM `tmp_project_ids`
);

DELETE FROM `project_counters`
WHERE `project_id` IN (
  SELECT `project_id` FROM `tmp_project_ids`
);

DELETE FROM `aims_project_members`
WHERE `project_id` IN (
  SELECT `project_id` FROM `tmp_project_ids`
);

-- ============================================================
-- 3. 需求域数据
-- ============================================================

DELETE FROM `requirement_review_batches`
WHERE `project_id` IN (
  SELECT `project_id` FROM `tmp_project_ids`
);

DELETE FROM `requirement_item_contents`
WHERE `requirement_id` IN (
  SELECT `requirement_id` FROM `tmp_requirement_ids`
);

DELETE FROM `requirement_versions`
WHERE `requirement_id` IN (
  SELECT `requirement_id` FROM `tmp_requirement_ids`
);

DELETE FROM `requirement_items`
WHERE `id` IN (
  SELECT `requirement_id` FROM `tmp_requirement_ids`
);

DELETE FROM `requirement_contents`
WHERE `project_id` IN (
  SELECT `project_id` FROM `tmp_project_ids`
);

-- ============================================================
-- 4. 主实体删除顺序：工作项 -> 里程碑 -> 项目
-- ============================================================

DELETE FROM `work_items`
WHERE `id` IN (
  SELECT `work_item_id` FROM `tmp_work_item_ids`
);

DELETE FROM `milestones`
WHERE `id` IN (
  SELECT `milestone_id` FROM `tmp_milestone_ids`
);

DELETE FROM `aims_projects`
WHERE `id` IN (
  SELECT `project_id` FROM `tmp_project_ids`
);

-- ============================================================
-- 5. 清理结果检查
-- ============================================================

SELECT
  (SELECT COUNT(*) FROM `aims_projects` WHERE `id` = @project_id) AS `remaining_projects`,
  (SELECT COUNT(*) FROM `milestones` WHERE `project_id` = @project_id) AS `remaining_milestones`,
  (SELECT COUNT(*) FROM `work_items` WHERE `project_id` = @project_id) AS `remaining_work_items`,
  (SELECT COUNT(*) FROM `requirement_items` WHERE `project_id` = @project_id) AS `remaining_requirements`,
  (SELECT COUNT(*) FROM `requirement_contents` WHERE `project_id` = @project_id) AS `remaining_requirement_contents`,
  (SELECT COUNT(*) FROM `project_documents` WHERE `project_id` = @project_id) AS `remaining_project_documents`,
  (SELECT COUNT(*) FROM `gitlab_commits` WHERE `project_id` = @project_id) AS `remaining_gitlab_commits`;

COMMIT;
