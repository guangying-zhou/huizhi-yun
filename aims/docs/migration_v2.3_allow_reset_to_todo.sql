-- ============================================================
-- Migration v2.3: 允许工作项从"执行中"退回"待办"
-- ============================================================
-- 变更说明:
--   为 target 和 matter 两层新增 in_progress → todo 的系统默认流转（reset）
--   用于支持看板页面把任务从"执行中"拖回"待办"列
-- ============================================================

USE `hzy_aims`;

-- 幂等插入：仅当系统默认规则尚未存在时插入
INSERT INTO `workflow_transitions` (`project_id`, `entity_type`, `from_status`, `to_status`, `transition_key`)
SELECT * FROM (
  SELECT NULL AS project_id, 'target' AS entity_type, 'in_progress' AS from_status, 'todo' AS to_status, 'reset' AS transition_key
) AS t
WHERE NOT EXISTS (
  SELECT 1 FROM `workflow_transitions`
  WHERE `project_id` IS NULL
    AND `entity_type` = 'target'
    AND `from_status` = 'in_progress'
    AND `to_status` = 'todo'
);

INSERT INTO `workflow_transitions` (`project_id`, `entity_type`, `from_status`, `to_status`, `transition_key`)
SELECT * FROM (
  SELECT NULL AS project_id, 'matter' AS entity_type, 'in_progress' AS from_status, 'todo' AS to_status, 'reset' AS transition_key
) AS t
WHERE NOT EXISTS (
  SELECT 1 FROM `workflow_transitions`
  WHERE `project_id` IS NULL
    AND `entity_type` = 'matter'
    AND `from_status` = 'in_progress'
    AND `to_status` = 'todo'
);
