-- ============================================================
-- hzy_console v1 Account -> Console business domains migration
--
-- Purpose:
--   Move Account business domain dictionary data into Console org profile
--   domain tables. Aims reads these domains through Console after Account
--   directory/runtime is retired.
--
-- Prerequisites:
--   1. Run docs/Console-SQL-DDL-Draft-v1.sql, or equivalent Console schema.
--   2. hzy_account and hzy_console are on the same MySQL instance.
-- ============================================================

USE `hzy_console`;


ALTER TABLE `org_business_domains`
  ADD COLUMN `alias_name` VARCHAR(255) NULL
    COMMENT '企业内显示别名，为空时使用 domain_name'
    AFTER `category`;

START TRANSACTION;

INSERT INTO `org_business_domains` (
  `domain_code`,
  `domain_name`,
  `category`,
  `parent_id`,
  `description`,
  `source`,
  `sort_order`,
  `status`,
  `created_at`,
  `updated_at`
)
SELECT
  bd.`domain_code`,
  bd.`domain_name`,
  bd.`category`,
  NULL,
  bd.`description`,
  'account',
  COALESCE(bd.`sort_order`, 100),
  CASE bd.`status` WHEN 1 THEN 'active' ELSE 'inactive' END,
  COALESCE(bd.`created_at`, NOW()),
  COALESCE(bd.`updated_at`, NOW())
FROM `hzy_account`.`business_domains` bd
ON DUPLICATE KEY UPDATE
  `domain_name` = VALUES(`domain_name`),
  `category` = VALUES(`category`),
  `description` = VALUES(`description`),
  `source` = VALUES(`source`),
  `sort_order` = VALUES(`sort_order`),
  `status` = VALUES(`status`),
  `updated_at` = VALUES(`updated_at`);

UPDATE `org_business_domains` child
INNER JOIN `hzy_account`.`business_domains` bd
  ON bd.`domain_code` COLLATE utf8mb4_unicode_ci = child.`domain_code` COLLATE utf8mb4_unicode_ci
LEFT JOIN `org_business_domains` parent
  ON parent.`domain_code` COLLATE utf8mb4_unicode_ci = bd.`parent_code` COLLATE utf8mb4_unicode_ci
SET child.`parent_id` = parent.`id`
WHERE child.`source` = 'account';

COMMIT;

SELECT
  (SELECT COUNT(*) FROM `org_business_domains`) AS `business_domain_count`,
  (SELECT COUNT(*) FROM `org_business_domains` WHERE `status` = 'active') AS `active_business_domain_count`;
