-- ============================================================
-- v4.7 执行形态基础（PIVR V1.1 / B1.1）
--
-- 背景：
--   《汇智PIVR项目管理生命周期模型说明书V1.1》引入执行形态维度：
--     A 项目制 / B 服务制 / C 常设事务
--   形态通过项目集的默认分类承载，日常事务新增 routine 分类。
--
-- 目标：
--   1. project_portfolios 增加 default_category / is_system
--   2. 回填：is_product_line=1 的项目集默认分类为 product_dev
--   3. aims_projects / project_template_sets 分类枚举增加 routine
--   4. 预置「周期性服务」与「日常事务」两个系统项目集
--
-- 说明：
--   improvement 枚举值本次保留。已确认无存量项目（2026-08-31 核查为空），
--   入口下线稳定后可另行提交枚举清理脚本。
--   核查语句：
--     SELECT project_code, name, lifecycle_status, portfolio_id, created_at
--     FROM aims_projects WHERE category = 'improvement';
-- ============================================================

USE `hzy_aims`;

-- ------------------------------------------------------------
-- 1) project_portfolios.default_category
-- ------------------------------------------------------------
SET @has_portfolio_default_category := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'project_portfolios'
    AND COLUMN_NAME = 'default_category'
);

SET @sql := IF(
  @has_portfolio_default_category = 0,
  'ALTER TABLE `project_portfolios`
     ADD COLUMN `default_category`
       ENUM(''product_dev'',''custom_dev'',''delivery'',''maintenance'',''sales'',''presales'',''compliance'',''routine'')
       DEFAULT NULL
       COMMENT ''子项目默认分类, NULL=不预设; routine 为强约束不可覆盖''
     AFTER `is_product_line`',
  'SELECT ''project_portfolios.default_category already exists'' AS msg'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ------------------------------------------------------------
-- 2) project_portfolios.is_system
-- ------------------------------------------------------------
SET @has_portfolio_is_system := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'project_portfolios'
    AND COLUMN_NAME = 'is_system'
);

SET @sql := IF(
  @has_portfolio_is_system = 0,
  'ALTER TABLE `project_portfolios`
     ADD COLUMN `is_system` TINYINT(1) NOT NULL DEFAULT 0
     COMMENT ''系统预置项目集, 1=不可删除''
     AFTER `default_category`',
  'SELECT ''project_portfolios.is_system already exists'' AS msg'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ------------------------------------------------------------
-- 3) default_category 索引
-- ------------------------------------------------------------
SET @has_idx_portfolio_default_category := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'project_portfolios'
    AND INDEX_NAME = 'idx_portfolio_default_category'
);

SET @sql := IF(
  @has_idx_portfolio_default_category = 0,
  'ALTER TABLE `project_portfolios`
     ADD KEY `idx_portfolio_default_category` (`default_category`)',
  'SELECT ''project_portfolios.idx_portfolio_default_category already exists'' AS msg'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ------------------------------------------------------------
-- 4) 回填：产品线项目集等价于默认分类 product_dev
-- ------------------------------------------------------------
UPDATE `project_portfolios`
SET `default_category` = 'product_dev'
WHERE `is_product_line` = 1
  AND `default_category` IS NULL;

-- ------------------------------------------------------------
-- 5) 分类枚举增加 routine
--    MODIFY COLUMN 本身幂等，重复执行结果一致
-- ------------------------------------------------------------
ALTER TABLE `aims_projects`
  MODIFY COLUMN `category`
    ENUM('product_dev','custom_dev','delivery','maintenance',
         'sales','presales','improvement','compliance','routine')
    NOT NULL DEFAULT 'product_dev'
    COMMENT '项目分类(improvement 已停用, 保留供存量读取; routine=日常事务容器)';

ALTER TABLE `project_template_sets`
  MODIFY COLUMN `category`
    ENUM('product_dev','custom_dev','delivery','maintenance',
         'sales','presales','improvement','compliance','routine')
    NOT NULL
    COMMENT '适用项目分类(improvement 已停用, 保留供存量读取)';

-- ------------------------------------------------------------
-- 6) 预置系统项目集
-- ------------------------------------------------------------
-- 周期性服务：承载 maintenance 服务年度项目，默认分类可在创建时覆盖
INSERT INTO `project_portfolios`
  (`code`, `name`, `description`, `is_product_line`, `default_category`,
   `is_system`, `display_order`, `status`, `created_by`)
SELECT 'SVC', '周期性服务',
       '维保、托管运维等周期型服务的服务年度项目集合。同一客户同一服务的历年项目由 service_line_code 串联。',
       0, 'maintenance', 1, 900, 'active', 'system'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `project_portfolios` WHERE `code` = 'SVC');

-- 日常事务：全局唯一，承载 routine 容器，分类为强约束
INSERT INTO `project_portfolios`
  (`code`, `name`, `description`, `is_product_line`, `default_category`,
   `is_system`, `display_order`, `status`, `created_by`)
SELECT 'ROUTINE', '日常事务',
       '不立项的日常工作容器集合，按部门 × 年建立。其下项目分类固定为 routine，不使用 PIVR 阶段与里程碑。',
       0, 'routine', 1, 999, 'active', 'system'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `project_portfolios` WHERE `code` = 'ROUTINE');

-- ------------------------------------------------------------
-- 7) 校验
-- ------------------------------------------------------------
-- 预期返回两行，default_category 分别为 maintenance 与 routine
SELECT `code`, `name`, `default_category`, `is_system`
FROM `project_portfolios`
WHERE `is_system` = 1;

-- 预期：default_category='routine' 的项目集有且仅有一个
SELECT COUNT(*) AS routine_portfolio_count
FROM `project_portfolios`
WHERE `default_category` = 'routine';
