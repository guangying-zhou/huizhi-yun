-- ============================================================
-- Migration: 005_action_def_source
-- Purpose: 区分审批动作来源（手动创建 vs 应用同步）
-- Date: 2026-04-01
-- ============================================================

ALTER TABLE flow_action_defs
  ADD COLUMN source ENUM('manual', 'sync') NOT NULL DEFAULT 'manual'
  COMMENT '来源：manual=手动创建, sync=应用自动同步'
  AFTER status;

-- 将已有的 aims 自动注册的记录标记为 sync
UPDATE flow_action_defs SET source = 'sync' WHERE app_code = 'aims';
