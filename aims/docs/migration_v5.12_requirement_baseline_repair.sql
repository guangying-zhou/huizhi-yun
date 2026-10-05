-- =====================================================================
-- Aims v5.12: 修复缺少“需求基线”工作项的研发项目。
--
-- v3.1 只为已有 requirement_items 的项目创建基线，导致尚未导入规格书的
-- 存量项目无法显示“导入规格书”按钮。本迁移为启用需求模块且仍可编辑的
-- 产品研发/定制开发项目补齐唯一的 requirement baseline，并同步工作项计数器。
-- =====================================================================

START TRANSACTION;

-- 存量项目可能已经有旧版 requirement target，但没有 requirement_baseline
-- 标识。优先沿用 I 阶段中排序最前的旧目标，避免创建重复的需求目标。
DROP TEMPORARY TABLE IF EXISTS `tmp_requirement_baseline_repairs`;

CREATE TEMPORARY TABLE `tmp_requirement_baseline_repairs` (
  `project_id` BIGINT NOT NULL,
  `work_item_id` BIGINT NOT NULL,
  PRIMARY KEY (`project_id`),
  UNIQUE KEY `uk_tmp_requirement_baseline_work_item` (`work_item_id`)
);

INSERT INTO `tmp_requirement_baseline_repairs` (`project_id`, `work_item_id`)
SELECT ranked.project_id, ranked.work_item_id
FROM (
  SELECT
    p.id AS project_id,
    legacy.id AS work_item_id,
    ROW_NUMBER() OVER (
      PARTITION BY p.id
      ORDER BY
        legacy.sort_order ASC,
        legacy.id ASC
    ) AS candidate_rank
  FROM `aims_projects` p
  JOIN `work_items` legacy
    ON legacy.project_id = p.id
   AND legacy.tier = 'target'
   AND legacy.type = 'requirement'
  JOIN `milestones` legacy_milestone
    ON legacy_milestone.id = legacy.milestone_id
   AND legacy_milestone.pivr_stage = 'I'
   AND legacy_milestone.completion_lock_request_id IS NULL
  WHERE p.category IN ('product_dev', 'custom_dev')
    AND p.lifecycle_status IN ('draft', 'approval_pending', 'active', 'paused')
    AND COALESCE(
      JSON_UNQUOTE(JSON_EXTRACT(p.module_config, '$.requirements')),
      'true'
    ) NOT IN ('false', '0')
    AND NOT EXISTS (
      SELECT 1
      FROM `work_items` baseline
      WHERE baseline.project_id = p.id
        AND baseline.template_key = 'requirement_baseline'
    )
) ranked
WHERE ranked.candidate_rank = 1;

UPDATE `work_items` legacy
JOIN `tmp_requirement_baseline_repairs` repair
  ON repair.work_item_id = legacy.id
SET
  legacy.template_key = 'requirement_baseline',
  legacy.required = 1,
  legacy.review_level = 1,
  legacy.sort_order = -1;

INSERT INTO `work_items` (
  `project_id`, `milestone_id`, `item_number`, `item_key`,
  `tier`, `type`, `title`, `description`,
  `status`, `priority`, `reporter_uid`,
  `review_level`, `required`, `template_key`, `sort_order`
)
SELECT
  p.id,
  m.id,
  COALESCE((
    SELECT MAX(existing.item_number)
    FROM `work_items` existing
    WHERE existing.project_id = p.id
  ), 0) + 1,
  CONCAT(
    p.project_code,
    '-',
    COALESCE((
      SELECT MAX(existing.item_number)
      FROM `work_items` existing
      WHERE existing.project_id = p.id
    ), 0) + 1
  ),
  'target',
  'requirement',
  '需求分解',
  '本项目的需求分解工作项，挂载所有基线评审通过的需求项，聚合由需求分解出的实施任务。',
  'planning',
  'P1',
  COALESCE(NULLIF(TRIM(p.leader_uid), ''), p.created_by),
  1,
  1,
  'requirement_baseline',
  -1
FROM `aims_projects` p
JOIN `milestones` m
  ON m.id = (
    SELECT candidate.id
    FROM `milestones` candidate
    WHERE candidate.project_id = p.id
      AND candidate.pivr_stage = 'I'
      AND candidate.completion_lock_request_id IS NULL
    ORDER BY candidate.sort_order ASC, candidate.id ASC
    LIMIT 1
  )
WHERE p.category IN ('product_dev', 'custom_dev')
  AND p.lifecycle_status IN ('draft', 'approval_pending', 'active', 'paused')
  AND COALESCE(
    JSON_UNQUOTE(JSON_EXTRACT(p.module_config, '$.requirements')),
    'true'
  ) NOT IN ('false', '0')
  AND NOT EXISTS (
    SELECT 1
    FROM `work_items` baseline
    WHERE baseline.project_id = p.id
      AND baseline.template_key = 'requirement_baseline'
  );

INSERT INTO `project_counters` (`project_id`, `counter`)
SELECT repaired.project_id, MAX(repaired.item_number)
FROM `work_items` repaired
WHERE repaired.template_key = 'requirement_baseline'
GROUP BY repaired.project_id
ON DUPLICATE KEY UPDATE
  `counter` = GREATEST(`project_counters`.`counter`, VALUES(`counter`));

COMMIT;

DROP TEMPORARY TABLE IF EXISTS `tmp_requirement_baseline_repairs`;

SELECT COUNT(*) AS remaining_projects_without_requirement_baseline
FROM `aims_projects` p
WHERE p.category IN ('product_dev', 'custom_dev')
  AND p.lifecycle_status IN ('draft', 'approval_pending', 'active', 'paused')
  AND COALESCE(
    JSON_UNQUOTE(JSON_EXTRACT(p.module_config, '$.requirements')),
    'true'
  ) NOT IN ('false', '0')
  AND EXISTS (
    SELECT 1
    FROM `milestones` candidate
    WHERE candidate.project_id = p.id
      AND candidate.pivr_stage = 'I'
      AND candidate.completion_lock_request_id IS NULL
  )
  AND NOT EXISTS (
    SELECT 1
    FROM `work_items` baseline
    WHERE baseline.project_id = p.id
      AND baseline.template_key = 'requirement_baseline'
  );
