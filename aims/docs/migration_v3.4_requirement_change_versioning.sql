-- ============================================================
-- AIMS v3.4: 需求变更与规格书内容版本化
-- ============================================================

ALTER TABLE `requirement_items`
  ADD COLUMN `item_kind` ENUM('baseline','change') NOT NULL DEFAULT 'baseline' COMMENT 'baseline=基线需求, change=变更需求' AFTER `id`,
  ADD COLUMN `parent_requirement_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '变更需求对应的原始基线需求ID' AFTER `item_kind`,
  ADD COLUMN `change_no` INT UNSIGNED DEFAULT NULL COMMENT '同一基线需求下的变更序号' AFTER `parent_requirement_id`,
  ADD COLUMN `change_reason` TEXT DEFAULT NULL COMMENT '变更原因' AFTER `change_no`,
  ADD KEY `idx_req_parent_requirement` (`parent_requirement_id`),
  ADD UNIQUE KEY `uk_req_change_no` (`parent_requirement_id`, `change_no`),
  ADD CONSTRAINT `fk_req_parent_requirement` FOREIGN KEY (`parent_requirement_id`) REFERENCES `requirement_items` (`id`) ON DELETE SET NULL;

ALTER TABLE `requirement_contents`
  ADD COLUMN `content_original_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '同一逻辑章节/内容族的首个内容ID' AFTER `id`,
  ADD COLUMN `version_no` INT UNSIGNED NOT NULL DEFAULT 1 COMMENT '内容版本号' AFTER `content_original_id`,
  ADD COLUMN `version_status` ENUM('draft','baselined','change_draft','in_review','archived') NOT NULL DEFAULT 'draft' COMMENT '内容版本状态' AFTER `version_no`,
  ADD KEY `idx_req_content_original_status` (`content_original_id`, `version_status`),
  ADD UNIQUE KEY `uk_req_content_original_version` (`content_original_id`, `version_no`);

UPDATE `requirement_contents`
SET `content_original_id` = `id`,
    `version_no` = 1,
    `version_status` = CASE
      WHEN `requirement_id` IS NULL THEN 'draft'
      ELSE 'baselined'
    END
WHERE `content_original_id` IS NULL;

CREATE TABLE IF NOT EXISTS `requirement_item_contents` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `requirement_id` BIGINT UNSIGNED NOT NULL,
  `content_id` BIGINT UNSIGNED NOT NULL,
  `relation_type` ENUM('baseline','change','archived') NOT NULL DEFAULT 'baseline',
  `sort_order` INT UNSIGNED NOT NULL DEFAULT 0,
  `created_by` VARCHAR(64) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_req_content_relation` (`requirement_id`, `content_id`, `relation_type`),
  KEY `idx_req_item_content_requirement` (`requirement_id`, `relation_type`),
  KEY `idx_req_item_content_content` (`content_id`),
  CONSTRAINT `fk_req_item_content_requirement` FOREIGN KEY (`requirement_id`) REFERENCES `requirement_items` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_req_item_content_content` FOREIGN KEY (`content_id`) REFERENCES `requirement_contents` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='需求项与规格书内容版本关联';

INSERT IGNORE INTO `requirement_item_contents`
  (`requirement_id`, `content_id`, `relation_type`, `sort_order`, `created_by`)
SELECT
  `requirement_id`,
  `id`,
  'baseline',
  `sort_order`,
  `created_by`
FROM `requirement_contents`
WHERE `requirement_id` IS NOT NULL;
