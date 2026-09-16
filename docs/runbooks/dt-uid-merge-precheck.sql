-- dt-* 主体归并前的一次性跨应用引用核查。
--
-- 归并会改写 employee_uid —— 一个跨模块稳定标识。漏掉一处引用的表现是
-- 静默的数据损坏，没有报错也没有异常。因此在执行归并之前，必须对每个
-- 应用库分别跑一遍本脚本并确认结果为空。
--
-- 用法：把下面的 dt-REPLACE_ME 换成待归并的 dt-* UID，逐个数据库整段执行。
--
-- 脚本有四步输出，判读方式各不相同：
--   1. 列清单        —— 供人工确认覆盖面
--   2. （无输出）     —— 构建语句
--   3. 覆盖检查      —— 必须是 PASS，但这只说明脚本没被截断，不是核查结果
--   4. 命中列表      —— **这一步才是答案**。空结果集 = 该库干净；
--                        返回任何行都要按 runbook 分类判断。
--
-- 只看到第 3 步的 PASS 就认为干净，是本脚本最容易被误读的地方。
--
-- 重要：UID 不只以 *_uid 形式出现。created_by / confirmed_by /
-- calculated_by / approved_by 这类列同样存 UID，altoc 的 *_by 列甚至比
-- *_uid 更多。本脚本按 information_schema 枚举两类列名，不依赖单一约定。

SET @legacy_uid = 'dt-REPLACE_ME';

-- 占位符未替换时，第四步必然返回空结果集——一个假的「干净」。
-- 这里先确定性中断，不让它有机会被误读成核查通过。
--
-- 先给出可读诊断：中断本身只会抛一个 duplicate key，看不出原因。
SELECT
  COALESCE(@legacy_uid, '(未设置)') AS `legacy_uid`,
  CASE
    WHEN @legacy_uid IS NULL
      THEN 'FAIL: 变量未设置。整段执行本脚本，不要只运行选中的语句。'
    WHEN @legacy_uid NOT REGEXP '^dt-'
      THEN 'FAIL: 不是 dt- 开头。本脚本只用于核查合成主体。'
    WHEN @legacy_uid NOT REGEXP '^dt-[0-9a-fA-F]{16,64}$'
      THEN 'FAIL: dt- 之后不是 16-64 位十六进制。占位符未替换，或 UID 抄错。'
    ELSE 'PASS: UID 形态正确'
  END AS `uid_check`;

DROP TEMPORARY TABLE IF EXISTS `_dt_merge_uid_guard`;
CREATE TEMPORARY TABLE `_dt_merge_uid_guard` (
  `guard_id` TINYINT NOT NULL,
  PRIMARY KEY (`guard_id`)
);
INSERT INTO `_dt_merge_uid_guard` (`guard_id`) VALUES (1);
-- 用结构校验而不是比对占位符字面量：操作者用查找替换填 UID 时，
-- 字面量比较会连守卫自己一起被改掉，从而永远命中。
-- 合成 UID 的形态是 dt- 加十六进制摘要，占位符不满足。
INSERT INTO `_dt_merge_uid_guard` (`guard_id`)
SELECT 1 FROM DUAL
WHERE @legacy_uid IS NULL
   OR @legacy_uid NOT REGEXP '^dt-[0-9a-fA-F]{16,64}$';
DROP TEMPORARY TABLE `_dt_merge_uid_guard`;

-- GROUP_CONCAT 默认上限只有 1024 字节，会把生成的语句从中间截断。
-- 截断如果恰好落在语句边界，剩下的部分仍能执行并给出一个错误的零，
-- 因此必须同时调大上限并在下面校验语句条数。
SET SESSION group_concat_max_len = 33554432;

-- 第一步：列出本库中所有可能承载 UID 的列，供人工确认覆盖面。
-- 如果这里出现了既不以 _uid 也不以 _by 结尾、却存 UID 的列，
-- 必须手工补查——本脚本无法自动发现它。
SELECT
  TABLE_NAME AS `table`,
  COLUMN_NAME AS `column`,
  COLUMN_TYPE AS `type`
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND (COLUMN_NAME LIKE '%\_uid' OR COLUMN_NAME LIKE '%\_by')
  AND DATA_TYPE IN ('varchar', 'char')
ORDER BY TABLE_NAME, COLUMN_NAME;

-- 第二步：构建逐列计数语句，并记录应有的列数。
SELECT COUNT(*) INTO @column_count
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND (COLUMN_NAME LIKE '%\_uid' OR COLUMN_NAME LIKE '%\_by')
  AND DATA_TYPE IN ('varchar', 'char');

-- 列的排序规则常是 utf8mb4_unicode_ci，而 @legacy_uid 取连接默认的
-- utf8mb4_0900_ai_ci，直接比较会报 1267 Illegal mix of collations。
-- 逐列注入该列自身的 COLLATION_NAME：两侧同规则，既能比较也不破坏索引。
SELECT GROUP_CONCAT(
  CONCAT(
    'SELECT ''', TABLE_NAME, ''' AS `table`, ''', COLUMN_NAME, ''' AS `column`, COUNT(*) AS hits ',
    'FROM `', TABLE_NAME, '` WHERE `', COLUMN_NAME, '` = ', QUOTE(@legacy_uid),
    IF(COLLATION_NAME IS NULL, '', CONCAT(' COLLATE ', COLLATION_NAME))
  )
  SEPARATOR ' UNION ALL '
) INTO @union_sql
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND (COLUMN_NAME LIKE '%\_uid' OR COLUMN_NAME LIKE '%\_by')
  AND DATA_TYPE IN ('varchar', 'char');

-- 第三步：校验生成的语句条数与列数一致。截断必须失败关闭，
-- 绝不能带着一份残缺的语句继续执行并报告「零引用」。
SET @generated_count = IF(
  @union_sql IS NULL,
  0,
  -- 用 DIV 做整数除法：`/` 返回 DECIMAL，会显示成 44.000000000，
  -- 让操作者在本该一眼确认相等的地方产生犹豫。
  (LENGTH(@union_sql) - LENGTH(REPLACE(@union_sql, ' UNION ALL ', ''))) DIV LENGTH(' UNION ALL ') + 1
);

SELECT
  @column_count AS `columns_found`,
  @generated_count AS `statements_generated`,
  CASE
    WHEN @column_count = @generated_count THEN 'PASS: 覆盖完整'
    ELSE 'FAIL: 生成语句被截断，结果不可信，请勿继续归并'
  END AS `coverage_check`;

-- 条数不一致时以重复主键确定性中断，避免操作者忽略上面的 FAIL 继续往下跑。
DROP TEMPORARY TABLE IF EXISTS `_dt_merge_coverage_guard`;
CREATE TEMPORARY TABLE `_dt_merge_coverage_guard` (
  `guard_id` TINYINT NOT NULL,
  PRIMARY KEY (`guard_id`)
);
INSERT INTO `_dt_merge_coverage_guard` (`guard_id`) VALUES (1);
INSERT INTO `_dt_merge_coverage_guard` (`guard_id`)
SELECT 1 FROM DUAL WHERE @column_count <> @generated_count;
DROP TEMPORARY TABLE `_dt_merge_coverage_guard`;

-- 第四步：只返回命中的列。空结果集 = 该库没有任何引用，可以继续归并。
-- 返回任何行都表示该 UID 仍被引用，必须停止自动归并。
SET @sql = IF(
  @union_sql IS NULL,
  'SELECT ''(本库没有可能承载 UID 的列)'' AS `table`, '''' AS `column`, 0 AS hits FROM DUAL WHERE 1=0',
  CONCAT('SELECT * FROM (', @union_sql, ') AS scan WHERE hits > 0 ORDER BY `table`, `column`')
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
