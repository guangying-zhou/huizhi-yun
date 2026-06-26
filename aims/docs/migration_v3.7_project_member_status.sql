-- ============================================================
-- 迁移脚本：项目成员状态字段补齐
--
-- 背景：
--   aims_schema.sql 已声明 aims_project_members.status，但部分开发库
--   仍停留在旧结构，导致依赖成员状态的接口报 Unknown column 'status'。
-- ============================================================

USE `hzy_aims`;

ALTER TABLE `aims_project_members`
  ADD COLUMN IF NOT EXISTS `status` ENUM('active','suspended')
    NOT NULL DEFAULT 'active'
    COMMENT '成员状态: active=正常, suspended=已暂停'
    AFTER `role`;

