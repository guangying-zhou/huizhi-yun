-- ============================================================
-- Migration: 004_flow_templates
-- Purpose: 流程模板功能，在 flow_schemas 上增加模板标记和预置模板
-- Date: 2026-04-01
-- ============================================================

-- 1. flow_schemas 新增模板标记
ALTER TABLE flow_schemas
  ADD COLUMN is_template TINYINT(1) NOT NULL DEFAULT 0
  COMMENT '是否为系统模板（1=模板，0=业务流程）'
  AFTER status;

-- 2. 将现有记录标记为非模板
UPDATE flow_schemas SET is_template = 0 WHERE is_template = 0;

-- 3. 插入预置模板

-- 模板1：单级审批（部门经理）
INSERT INTO flow_schemas (code, name, description, nodes, config, version, status, is_template, created_by, created_at, updated_at)
VALUES (
  'tpl_single_approval',
  '单级审批',
  '部门经理审批，适用于简单事项',
  JSON_ARRAY(
    JSON_OBJECT(
      'name', '部门经理审批',
      'type', 'approve',
      'approve_mode', 'any',
      'assignees', JSON_ARRAY(
        JSON_OBJECT('type', 'dept_manager', 'scope', 'initiator_dept')
      )
    )
  ),
  JSON_OBJECT(
    'allow_withdraw', TRUE,
    'allow_resubmit', TRUE,
    'reject_strategy', 'to_initiator',
    'notify_channels', JSON_ARRAY('wecom')
  ),
  1, 1, 1, 'system', NOW(), NOW()
);

-- 模板2：二级审批（部门经理 → 分管领导）
INSERT INTO flow_schemas (code, name, description, nodes, config, version, status, is_template, created_by, created_at, updated_at)
VALUES (
  'tpl_two_level_approval',
  '二级审批',
  '部门经理审核 → 分管领导审批，适用于常规审批事项',
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
  1, 1, 1, 'system', NOW(), NOW()
);

-- 模板3：三级审批（部门经理 → 分管领导 → 上级部门负责人）
INSERT INTO flow_schemas (code, name, description, nodes, config, version, status, is_template, created_by, created_at, updated_at)
VALUES (
  'tpl_three_level_approval',
  '三级审批',
  '部门经理审核 → 分管领导审批 → 上级部门负责人审批，适用于重大事项',
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
    ),
    JSON_OBJECT(
      'name', '上级部门负责人审批',
      'type', 'approve',
      'approve_mode', 'any',
      'assignees', JSON_ARRAY(
        JSON_OBJECT('type', 'dept_manager', 'scope', 'resource_dept')
      ),
      'skip_when', JSON_OBJECT('initiator_dept_code', JSON_OBJECT('$eq', 'ROOT'))
    )
  ),
  JSON_OBJECT(
    'allow_withdraw', TRUE,
    'allow_resubmit', TRUE,
    'reject_strategy', 'to_initiator',
    'notify_channels', JSON_ARRAY('wecom')
  ),
  1, 1, 1, 'system', NOW(), NOW()
);

-- 模板4：委员会表决
INSERT INTO flow_schemas (code, name, description, nodes, config, version, status, is_template, created_by, created_at, updated_at)
VALUES (
  'tpl_committee_vote',
  '委员会表决',
  '指定角色全员会签，适用于集体决策事项',
  JSON_ARRAY(
    JSON_OBJECT(
      'name', '委员会表决',
      'type', 'countersign',
      'approve_mode', 'all',
      'assignees', JSON_ARRAY(
        JSON_OBJECT('type', 'role', 'code', 'committee_member')
      )
    )
  ),
  JSON_OBJECT(
    'allow_withdraw', TRUE,
    'allow_resubmit', TRUE,
    'reject_strategy', 'to_initiator',
    'notify_channels', JSON_ARRAY('wecom')
  ),
  1, 1, 1, 'system', NOW(), NOW()
);
