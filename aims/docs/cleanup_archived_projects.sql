-- ============================================================
-- 清理 Aims 中所有已归档项目及其关联数据
-- 目标库: hzy_aims
-- 说明:
--   1. 只删除 aims_projects.lifecycle_status = 'archived' 的项目
--   2. 先删无强外键/聚合表, 再删主业务表, 最后删 aims_projects
--   3. deliverables / approval_records 已改为显式 owner 外键模型
--   4. 如需先演练, 可将最后一行 COMMIT 改成 ROLLBACK
-- ============================================================

USE `hzy_aims`;

START TRANSACTION;

DROP TEMPORARY TABLE IF EXISTS `tmp_archived_project_ids`;
CREATE TEMPORARY TABLE `tmp_archived_project_ids` (
  `project_id` BIGINT UNSIGNED NOT NULL PRIMARY KEY
) ENGINE=Memory;

INSERT INTO `tmp_archived_project_ids` (`project_id`)
SELECT `id`
FROM `aims_projects`
WHERE `lifecycle_status` = 'archived';

DROP TEMPORARY TABLE IF EXISTS `tmp_archived_milestone_ids`;
CREATE TEMPORARY TABLE `tmp_archived_milestone_ids` (
  `milestone_id` BIGINT UNSIGNED NOT NULL PRIMARY KEY
) ENGINE=Memory;

INSERT INTO `tmp_archived_milestone_ids` (`milestone_id`)
SELECT `id`
FROM `milestones`
WHERE `project_id` IN (
  SELECT `project_id` FROM `tmp_archived_project_ids`
);

DROP TEMPORARY TABLE IF EXISTS `tmp_archived_work_item_ids`;
CREATE TEMPORARY TABLE `tmp_archived_work_item_ids` (
  `work_item_id` BIGINT UNSIGNED NOT NULL PRIMARY KEY
) ENGINE=Memory;

INSERT INTO `tmp_archived_work_item_ids` (`work_item_id`)
SELECT `id`
FROM `work_items`
WHERE `project_id` IN (
  SELECT `project_id` FROM `tmp_archived_project_ids`
);

SELECT
  (SELECT COUNT(*) FROM `tmp_archived_project_ids`) AS `archived_projects`,
  (SELECT COUNT(*) FROM `tmp_archived_milestone_ids`) AS `milestones`,
  (SELECT COUNT(*) FROM `tmp_archived_work_item_ids`) AS `work_items`;

-- 无强外键的聚合/冗余表先删
-- MySQL 对同一个 TEMPORARY TABLE 在单条语句内重复引用有限制
-- 因此这里拆成多条 DELETE
DELETE FROM `deliverables`
WHERE `project_id` IN (
  SELECT `project_id` FROM `tmp_archived_project_ids`
);

DELETE FROM `deliverables`
WHERE `project_owner_id` IN (
    SELECT `project_id` FROM `tmp_archived_project_ids`
  );

DELETE FROM `deliverables`
WHERE `milestone_owner_id` IN (
    SELECT `milestone_id` FROM `tmp_archived_milestone_ids`
  );

DELETE FROM `deliverables`
WHERE `target_id` IN (
    SELECT `work_item_id` FROM `tmp_archived_work_item_ids`
  )
  OR `matter_id` IN (
    SELECT `work_item_id` FROM `tmp_archived_work_item_ids`
  );

DELETE FROM `approval_records`
WHERE `project_id` IN (
  SELECT `project_id` FROM `tmp_archived_project_ids`
);

DELETE FROM `approval_records`
WHERE `project_owner_id` IN (
    SELECT `project_id` FROM `tmp_archived_project_ids`
  );

DELETE FROM `approval_records`
WHERE `milestone_owner_id` IN (
    SELECT `milestone_id` FROM `tmp_archived_milestone_ids`
  );

DELETE FROM `approval_records`
WHERE `work_item_owner_id` IN (
    SELECT `work_item_id` FROM `tmp_archived_work_item_ids`
  );

-- 工作项子表
DELETE FROM `time_entries`
WHERE `work_item_id` IN (
  SELECT `work_item_id` FROM `tmp_archived_work_item_ids`
);

DELETE FROM `work_item_attachments`
WHERE `work_item_id` IN (
  SELECT `work_item_id` FROM `tmp_archived_work_item_ids`
);

DELETE FROM `work_item_changelog`
WHERE `work_item_id` IN (
  SELECT `work_item_id` FROM `tmp_archived_work_item_ids`
);

DELETE FROM `work_item_comments`
WHERE `work_item_id` IN (
  SELECT `work_item_id` FROM `tmp_archived_work_item_ids`
);

DELETE FROM `work_item_relations`
WHERE `source_id` IN (
  SELECT `work_item_id` FROM `tmp_archived_work_item_ids`
);

DELETE FROM `work_item_relations`
WHERE `target_id` IN (
  SELECT `work_item_id` FROM `tmp_archived_work_item_ids`
);

-- 文档表需在删 work_items / milestones 之前处理
DELETE FROM `project_documents`
WHERE `project_id` IN (
  SELECT `project_id` FROM `tmp_archived_project_ids`
)
OR `milestone_id` IN (
  SELECT `milestone_id` FROM `tmp_archived_milestone_ids`
)
OR `work_item_id` IN (
  SELECT `work_item_id` FROM `tmp_archived_work_item_ids`
);

DELETE FROM `gitlab_commits`
WHERE `project_id` IN (
  SELECT `project_id` FROM `tmp_archived_project_ids`
)
OR `work_item_id` IN (
  SELECT `work_item_id` FROM `tmp_archived_work_item_ids`
);

DELETE FROM `notification_rules`
WHERE `project_id` IN (
  SELECT `project_id` FROM `tmp_archived_project_ids`
);

DELETE FROM `workflow_transitions`
WHERE `project_id` IN (
  SELECT `project_id` FROM `tmp_archived_project_ids`
);

DELETE FROM `user_favorite_projects`
WHERE `project_id` IN (
  SELECT `project_id` FROM `tmp_archived_project_ids`
);

DELETE FROM `aims_project_repos`
WHERE `project_id` IN (
  SELECT `project_id` FROM `tmp_archived_project_ids`
);

DELETE FROM `project_counters`
WHERE `project_id` IN (
  SELECT `project_id` FROM `tmp_archived_project_ids`
);

DELETE FROM `aims_project_members`
WHERE `project_id` IN (
  SELECT `project_id` FROM `tmp_archived_project_ids`
);

-- 主实体删除顺序
DELETE FROM `work_items`
WHERE `id` IN (
  SELECT `work_item_id` FROM `tmp_archived_work_item_ids`
);

DELETE FROM `milestones`
WHERE `id` IN (
  SELECT `milestone_id` FROM `tmp_archived_milestone_ids`
);

DELETE FROM `aims_projects`
WHERE `id` IN (
  SELECT `project_id` FROM `tmp_archived_project_ids`
);

SELECT COUNT(*) AS `remaining_archived_projects`
FROM `aims_projects`
WHERE `lifecycle_status` = 'archived';

COMMIT;
