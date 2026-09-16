-- ============================================================
-- AIMS v3.6: 章节与需求关联统一到 requirement_item_contents
-- ============================================================

-- 1. 将旧字段 requirement_contents.requirement_id 中的基线关联回填到关联表
INSERT IGNORE INTO `requirement_item_contents`
  (`requirement_id`, `content_id`, `relation_type`, `sort_order`, `created_by`)
SELECT
  c.`requirement_id`,
  c.`id`,
  'baseline',
  c.`sort_order`,
  c.`updated_by`
FROM `requirement_contents` c
WHERE c.`requirement_id` IS NOT NULL;

-- 2. 删除旧外键和索引
ALTER TABLE `requirement_contents`
  DROP FOREIGN KEY `fk_req_content_requirement`,
  DROP INDEX `idx_req_content_requirement`;

-- 3. 删除旧关联列，后续一律通过 requirement_item_contents 读取/维护关联
ALTER TABLE `requirement_contents`
  DROP COLUMN `requirement_id`;
