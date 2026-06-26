-- ============================================================
-- Migration: 002_foundation_integration
-- Purpose: 支持 Foundation Layer 审批中心集成
-- Date: 2026-03-31
-- ============================================================

-- 1. flow_action_defs 新增 embed_url_pattern
ALTER TABLE flow_action_defs
  ADD COLUMN embed_url_pattern VARCHAR(500) NULL
  COMMENT '业务详情嵌入URL模式，变量：{app_base_url} {resource_code} {biz_id}'
  AFTER icon;

-- 2. flow_instances 索引优化
-- 删除旧索引
ALTER TABLE flow_instances DROP INDEX idx_biz;

-- 新增 biz_key 组合索引（并发检查 + by-biz 查询）
ALTER TABLE flow_instances
  ADD INDEX idx_biz_key (app_code, resource_code, biz_id, action_code, status);

-- 新增发起人+应用索引（"我发起的"查询）
ALTER TABLE flow_instances
  ADD INDEX idx_initiator_app (initiator_uid, app_code, status, created_at);
