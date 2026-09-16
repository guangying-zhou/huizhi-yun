-- ============================================================
-- Migration v2.4: 交付物关联项目文档（文件名冗余）
-- ============================================================
-- 变更说明:
--   deliverables 表的 document_uuid 字段已存在，现补充 document_title 冗余字段，
--   避免每次列表都跨 Codocs 模块查询文档标题。title 在提交成果时由前端写入。
-- ============================================================

USE `hzy_aims`;

ALTER TABLE `deliverables`
  ADD COLUMN `document_title` VARCHAR(255) DEFAULT NULL
  COMMENT '关联文档标题（冗余自 codocs.documents.title，用于列表展示）'
  AFTER `document_uuid`;
