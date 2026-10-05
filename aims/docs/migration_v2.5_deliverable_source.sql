-- ============================================================
-- Migration v2.5: 交付物成果引用 + 任务分解流程重构
-- ============================================================
-- 变更说明:
--   1. deliverables 新增 source_deliverable_id：任务成果可以引用目标成果要求
--   2. 目标成果要求（挂在 target 上）→ 多个子任务（matter）的成果可以引用它
--   3. 为校验"目标所有成果都被任务覆盖"提供数据基础
--
-- 配合：前端 breakdown 页面重构为"目标只读 + 统一任务分配"，
--      废弃 tasks.distribute / tasks.revoke 审批动作（不再注册到 Workflow）
-- ============================================================

USE `hzy_aims`;

ALTER TABLE `deliverables`
  ADD COLUMN `source_deliverable_id` BIGINT UNSIGNED DEFAULT NULL
  COMMENT '引用的源成果要求ID（任务成果引用目标成果时使用；NULL 表示任务自有成果）'
  AFTER `document_title`,
  ADD KEY `idx_deliverable_source` (`source_deliverable_id`),
  ADD CONSTRAINT `fk_deliverable_source` FOREIGN KEY (`source_deliverable_id`)
    REFERENCES `deliverables` (`id`) ON DELETE SET NULL;
