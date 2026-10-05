-- 里程碑最终完成只能由当前项目总监通过 Workflow 批准。
-- 审批人来自 Aims 在发起前解析并冻结到 form_data 的单例角色持有人。

INSERT INTO flow_schemas (
  code, name, description, nodes, config, version, status, created_by, created_at, updated_at
) VALUES (
  'aims_milestone_completion',
  '里程碑完成审批',
  '项目经理申请完成，项目总监最终批准',
  JSON_ARRAY(
    JSON_OBJECT(
      'name', '项目总监审批',
      'type', 'approve',
      'approve_mode', 'any',
      'assignees', JSON_ARRAY(
        JSON_OBJECT('type', 'form_field', 'field_key', 'form_data.projectDirectorUid')
      )
    )
  ),
  JSON_OBJECT(
    'allow_withdraw', FALSE,
    'allow_resubmit', FALSE,
    'terminal_relaunch', TRUE,
    'reject_strategy', 'terminal',
    'notify_channels', JSON_ARRAY('wecom')
  ),
  1,
  1,
  'system',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  description = VALUES(description),
  nodes = VALUES(nodes),
  config = VALUES(config),
  status = 1,
  updated_at = UTC_TIMESTAMP();

INSERT INTO flow_action_defs (
  app_code, resource_code, action_code, name, description,
  form_schema_id, icon, embed_url_pattern, sort_order, status,
  created_by, created_at, updated_at
) VALUES (
  'aims',
  'milestones',
  'milestone_completion',
  '里程碑完成审批',
  '项目经理申请完成，项目总监最终批准',
  NULL,
  'i-lucide-badge-check',
  '{biz_url}',
  30,
  1,
  'system',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  description = VALUES(description),
  icon = VALUES(icon),
  embed_url_pattern = VALUES(embed_url_pattern),
  status = 1,
  updated_at = UTC_TIMESTAMP();

UPDATE flow_routes
SET flow_schema_id = (
      SELECT id FROM flow_schemas
      WHERE code = 'aims_milestone_completion'
      LIMIT 1
    ),
    name = '里程碑完成默认路由',
    description = '所有里程碑完成申请均由当前项目总监审批',
    conditions = '{}',
    priority = 100,
    is_default = 1,
    status = 1,
    updated_at = UTC_TIMESTAMP()
WHERE action_def_id = (
    SELECT id FROM flow_action_defs
    WHERE app_code = 'aims'
      AND resource_code = 'milestones'
      AND action_code = 'milestone_completion'
    LIMIT 1
  )
  AND is_default = 1;

INSERT INTO flow_routes (
  action_def_id, flow_schema_id, name, description, conditions,
  priority, is_default, status, created_by, created_at, updated_at
)
SELECT
  (
    SELECT id FROM flow_action_defs
    WHERE app_code = 'aims'
      AND resource_code = 'milestones'
      AND action_code = 'milestone_completion'
    LIMIT 1
  ),
  (
    SELECT id FROM flow_schemas
    WHERE code = 'aims_milestone_completion'
    LIMIT 1
  ),
  '里程碑完成默认路由',
  '所有里程碑完成申请均由当前项目总监审批',
  '{}',
  100,
  1,
  1,
  'system',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
WHERE NOT EXISTS (
  SELECT 1
  FROM flow_routes route
  WHERE route.action_def_id = (
      SELECT id FROM flow_action_defs
      WHERE app_code = 'aims'
        AND resource_code = 'milestones'
        AND action_code = 'milestone_completion'
      LIMIT 1
    )
    AND route.is_default = 1
);
