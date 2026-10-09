-- ============================================================
-- Migration v2.6: 需求分解功能
-- ============================================================
-- 变更说明:
--   1. work_items 新增 requirement_category：需求分类 (functional/non_functional)
--      — 仅分类模式下使用，平铺模式为 NULL
--   2. work_items 新增 decomposition_source_id：溯源列
--      — 指向产生该工作项的"需求分解"或"需求变更"容器工作项
--      — 独立于 parent_id；parent_id 仍只表达 target→task 关系
--   3. 新建 work_item_source_anchors 表：
--      — 记录工作项关联的源文档章节锚点
--      — 多锚点支持"打包合并任务"场景
--      — 展示时运行时按锚点从 Codocs 拉取章节原文（不复制到 description）
--
-- 配套：
--   — 需要通过"初始化需求分解容器"接口给项目补两个模板工作项：
--     template_key='requirement_breakdown' 和 'requirement_change'
--   — 后端 decompose-submit 事务在创建 work_items 后直接 INSERT time_entries，
--     并更新源工作项 approval_status/status 进入审批流
-- ============================================================

USE `hzy_aims`;

-- ---------------------------------------------------------------
-- 1. work_items 增加需求分类列与分解溯源列
-- ---------------------------------------------------------------
ALTER TABLE `work_items`
  ADD COLUMN `requirement_category` VARCHAR(32) DEFAULT NULL
    COMMENT '需求分类: functional(功能需求)/non_functional(非功能需求)，仅分类模式使用'
    AFTER `type`,
  ADD COLUMN `decomposition_source_id` BIGINT UNSIGNED DEFAULT NULL
    COMMENT '溯源：产生此工作项的需求分解/需求变更容器工作项ID'
    AFTER `template_key`,
  ADD KEY `idx_work_items_req_category` (`project_id`, `requirement_category`),
  ADD KEY `idx_work_items_decomp_src` (`decomposition_source_id`);

-- ---------------------------------------------------------------
-- 2. 工作项源文档锚点表
-- ---------------------------------------------------------------
-- 一条 work_item 可挂多条锚点（打包任务场景）
-- 展示顺序由 sort_order 决定
-- 源文档被删除时，锚点记录保留（work_item 仍然可用，UI 做断链降级提示）
CREATE TABLE IF NOT EXISTS `work_item_source_anchors` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `work_item_id` BIGINT UNSIGNED NOT NULL COMMENT '工作项ID',
  `source_document_uuid` CHAR(36) NOT NULL COMMENT '源文档UUID(Codocs)',
  `source_document_title` VARCHAR(255) NOT NULL COMMENT '源文档标题(冗余快照，断链时仍可展示)',
  `heading_anchor` VARCHAR(500) NOT NULL COMMENT '完整锚点文本(如 "2.1.1 用户注册")',
  `heading_depth` TINYINT NOT NULL COMMENT '标题层级: 2|3|4',
  `sort_order` INT NOT NULL DEFAULT 0 COMMENT '同一工作项多锚点的展示顺序',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_work_item` (`work_item_id`, `sort_order`),
  KEY `idx_source_doc` (`source_document_uuid`),
  KEY `idx_heading_anchor` (`source_document_uuid`, `heading_anchor`),
  CONSTRAINT `fk_anchor_work_item` FOREIGN KEY (`work_item_id`)
    REFERENCES `work_items` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='工作项源文档锚点(需求分解产物的章节引用)';
