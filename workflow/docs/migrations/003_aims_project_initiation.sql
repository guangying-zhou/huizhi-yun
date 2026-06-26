-- ============================================================
-- Migration: 003_aims_project_initiation
-- Purpose: 为 aims 项目立项配置审批动作定义、流程、路由
-- Date: 2026-03-31
-- ============================================================

-- 1. 创建项目立项审批流程定义（二级审批：部门经理 → 分管领导）
INSERT INTO flow_schemas (code, name, description, nodes, config, version, status, created_by, created_at, updated_at)
VALUES (
  'aims_project_initiation',
  '项目立项审批',
  '部门经理审核 → 分管领导审批',
  JSON_ARRAY(
    JSON_OBJECT(
      'name', '部门经理审核',
      'type', 'approve',
      'approve_mode', 'any',
      'assignees', JSON_ARRAY(
        JSON_OBJECT('type', 'dept_manager', 'scope', 'initiator_dept')
      )
    ),
    JSON_OBJECT(
      'name', '分管领导审批',
      'type', 'approve',
      'approve_mode', 'any',
      'assignees', JSON_ARRAY(
        JSON_OBJECT('type', 'dept_leader', 'scope', 'initiator_dept')
      )
    )
  ),
  JSON_OBJECT(
    'allow_withdraw', TRUE,
    'allow_resubmit', TRUE,
    'reject_strategy', 'to_initiator',
    'notify_channels', JSON_ARRAY('wecom')
  ),
  1,
  1,
  'system',
  NOW(),
  NOW()
);

-- 2. 注册 aims 项目立项动作定义
INSERT INTO flow_action_defs (app_code, resource_code, action_code, name, description, form_schema_id, icon, embed_url_pattern, sort_order, status, created_by, created_at, updated_at)
VALUES (
  'aims',
  'project',
  'initiation',
  '项目立项审批',
  '新项目立项审批，审核项目可行性、资源匹配和预算',
  NULL,
  'i-lucide-folder-plus',
  '{app_base_url}/embed/project/{biz_id}',
  10,
  1,
  'system',
  NOW(),
  NOW()
);

-- 3. 创建默认路由（所有项目立项走同一流程）
INSERT INTO flow_routes (action_def_id, flow_schema_id, name, description, conditions, priority, is_default, status, created_by, created_at, updated_at)
VALUES (
  (SELECT id FROM flow_action_defs WHERE app_code = 'aims' AND resource_code = 'project' AND action_code = 'initiation' LIMIT 1),
  (SELECT id FROM flow_schemas WHERE code = 'aims_project_initiation' LIMIT 1),
  '默认路由',
  '所有项目立项走统一审批流程',
  '{}',
  100,
  1,
  1,
  'system',
  NOW(),
  NOW()
);
