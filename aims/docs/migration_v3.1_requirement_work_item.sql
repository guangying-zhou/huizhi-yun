-- =====================================================================
-- v3.1 需求与工作项融合迁移
-- 目标：requirement_items 增加 work_item_id，绑定到该项目的"需求基线" target
--       （work_items: tier=target, type=requirement, template_key=requirement_baseline）
-- 归属：需求基线 target 挂在 Implementation 阶段的第一个里程碑下
-- 变更需求项 work_item 为用户手动创建（本迁移只负责基线 target），不在此处生成
-- =====================================================================

-- 1. 增加 work_item_id 列 + 索引 + 外键 (幂等)
SET @col_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'requirement_items'
    AND COLUMN_NAME = 'work_item_id'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE `requirement_items`
     ADD COLUMN `work_item_id` BIGINT UNSIGNED DEFAULT NULL
       COMMENT ''归属的需求工作项ID（tier=target,type=requirement；基线批次或变更批次）''
       AFTER `milestone_id`,
     ADD KEY `idx_req_work_item` (`work_item_id`),
     ADD CONSTRAINT `fk_req_item_work_item` FOREIGN KEY (`work_item_id`)
       REFERENCES `work_items` (`id`) ON DELETE SET NULL',
  'SELECT ''requirement_items.work_item_id already exists'' AS msg');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2. 对现有已有需求项的项目，回填"需求基线" target 并绑定
--    步骤：
--      (a) 找出有 requirement_items 的项目
--      (b) 找到该项目 Implementation 阶段的第一个里程碑（pivr_stage='implementation' 按 sort_order/start_date 最早）
--      (c) 若该项目尚未存在 template_key='requirement_baseline' 的 work_item，则创建
--      (d) 回填 requirement_items.work_item_id

-- 2a+2b+2c 创建 target (单条 INSERT ... SELECT，保证每个项目最多一条)
-- 注意：milestones.pivr_stage 是 ENUM('P','I','V','R')，不是 'implementation' 全称
INSERT INTO `work_items` (
  `project_id`, `milestone_id`, `item_number`, `item_key`,
  `tier`, `type`, `title`, `description`,
  `status`, `priority`, `reporter_uid`,
  `review_level`, `required`, `template_key`, `sort_order`
)
SELECT
  p.id AS project_id,
  m.id AS milestone_id,
  COALESCE((SELECT MAX(item_number) FROM work_items w WHERE w.project_id = p.id), 0) + 1 AS item_number,
  CONCAT(p.project_code, '-REQ-BASELINE') AS item_key,
  'target' AS tier,
  'requirement' AS type,
  '需求分解' AS title,
  '本项目的需求分解工作项，挂载所有基线评审通过的需求项，聚合由需求分解出的实施任务。' AS description,
  'planning' AS status,
  'P1' AS priority,
  COALESCE(p.leader_uid, p.created_by) AS reporter_uid,
  1 AS review_level,
  1 AS required,
  'requirement_baseline' AS template_key,
  -1 AS sort_order
FROM `aims_projects` p
JOIN (
  SELECT project_id, MIN(id) AS id
  FROM `milestones`
  WHERE pivr_stage = 'I'
  GROUP BY project_id
) impl ON impl.project_id = p.id
JOIN `milestones` m ON m.id = impl.id
WHERE EXISTS (
  SELECT 1 FROM `requirement_items` r WHERE r.project_id = p.id
)
AND NOT EXISTS (
  SELECT 1 FROM `work_items` w
  WHERE w.project_id = p.id
    AND w.tier = 'target'
    AND w.type = 'requirement'
    AND w.template_key = 'requirement_baseline'
);

-- 2d 回填 work_item_id
UPDATE `requirement_items` r
JOIN `work_items` w
  ON w.project_id = r.project_id
 AND w.tier = 'target'
 AND w.type = 'requirement'
 AND w.template_key = 'requirement_baseline'
SET r.work_item_id = w.id
WHERE r.work_item_id IS NULL;

-- 3. 完成
SELECT CONCAT('v3.1 requirement_items.work_item_id migration applied, ',
              (SELECT COUNT(*) FROM requirement_items WHERE work_item_id IS NOT NULL),
              ' requirements bound to baseline targets') AS msg;
