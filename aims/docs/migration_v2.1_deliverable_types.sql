-- ============================================================
-- Migration v2.1: 交付物类型调整 + 工作项评审级别
-- ============================================================
-- 变更说明:
--   1. deliverable_type: 去掉 review/other，新增 code/task
--   2. work_items: 新增 review_level 字段（评审级别）
-- ============================================================

-- 1. 调整 deliverable_type ENUM
--    先迁移已有数据，再修改列定义
UPDATE `deliverables` SET `deliverable_type` = 'task' WHERE `deliverable_type` IN ('review', 'other');

ALTER TABLE `deliverables`
  MODIFY COLUMN `deliverable_type` ENUM('document','code','artifact','task') NOT NULL DEFAULT 'document'
  COMMENT '交付物类型: document=文档, code=代码交付, artifact=部署包/环境交付, task=过程性事务';

-- 2. work_items 新增 review_level 字段
--    0=免评审, 1=一般(默认), 2=重要, 3=重大, 4=关键
ALTER TABLE `work_items`
  ADD COLUMN `review_level` TINYINT UNSIGNED NOT NULL DEFAULT 1
  COMMENT '评审级别: 0=免评审, 1=一般, 2=重要, 3=重大, 4=关键'
  AFTER `approval_status`;
