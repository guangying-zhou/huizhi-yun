-- Aims v5.18: 日常事务工作项统一为扁平任务。
--
-- 兼容旧页面曾允许选择需求/缺陷和目标层级的数据。迁移可安全重放。

START TRANSACTION;

UPDATE `work_items` wi
JOIN `aims_projects` p ON p.`id` = wi.`project_id`
SET wi.`type` = 'task',
    wi.`tier` = 'matter',
    wi.`milestone_id` = NULL,
    wi.`status` = CASE WHEN wi.`status` = 'planning' THEN 'todo' ELSE wi.`status` END
WHERE p.`category` = 'routine'
  AND (wi.`type` <> 'task'
       OR wi.`tier` <> 'matter'
       OR wi.`milestone_id` IS NOT NULL
       OR wi.`status` = 'planning');

COMMIT;

-- 验证：必须返回空结果。
SELECT wi.`id`, wi.`item_key`, wi.`type`, wi.`tier`, wi.`milestone_id`, wi.`status`
FROM `work_items` wi
JOIN `aims_projects` p ON p.`id` = wi.`project_id`
WHERE p.`category` = 'routine'
  AND (wi.`type` <> 'task'
       OR wi.`tier` <> 'matter'
       OR wi.`milestone_id` IS NOT NULL
       OR wi.`status` = 'planning');
