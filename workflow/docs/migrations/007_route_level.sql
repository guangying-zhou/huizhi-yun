-- ============================================================
-- Migration 007: flow_routes 增加评审级别字段
-- ============================================================
-- 支持按级别路由：同一审批动作可配置多个级别，
-- 每个级别对应不同的审批流程。
-- 级别定义: 0=免评审, 1=一般, 2=重要, 3=重大, 4=关键
-- ============================================================

ALTER TABLE `flow_routes`
  ADD COLUMN `level` TINYINT UNSIGNED NULL
  COMMENT '评审级别: NULL=不按级别匹配, 0=免评审, 1=一般, 2=重要, 3=重大, 4=关键'
  AFTER `flow_schema_id`;

-- 同一动作同一级别只能绑一个路由
ALTER TABLE `flow_routes`
  ADD UNIQUE KEY `uk_action_level` (`action_def_id`, `level`);
