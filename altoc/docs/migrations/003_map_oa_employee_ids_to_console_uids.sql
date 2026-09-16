-- ============================================================
-- Migration 003: 修正 OA 员工 ID 到 Console UID 的负责人映射
-- ============================================================
-- 背景：
--   早期 OA 迁移把 wb_employee.employee_id 写入 Altoc 的 owner_user_id。
--   Altoc 前端和权限体系使用 Console Directory 的 uid，因此需要将：
--     wb_employee.employee_id -> wb_employee.user_id -> sys_user.user_name -> directory_users.uid
--   映射回 Console uid。
--
-- 幂等性：
--   只更新仍为纯数字的 owner_user_id；已经是 uid 的记录不会被改动。
--   只有在 hzy_console.directory_users 中存在对应 uid 时才更新。
--
-- 执行前置：
--   源库 wizbizdb、目标库 hzy_altoc、Console 库 hzy_console 位于同一 MySQL 实例。

USE hzy_altoc;

DROP TEMPORARY TABLE IF EXISTS tmp_oa_employee_uid_map;
CREATE TEMPORARY TABLE tmp_oa_employee_uid_map (
  employee_id BIGINT PRIMARY KEY,
  console_uid VARCHAR(128) COLLATE utf8mb4_unicode_ci NOT NULL,
  sys_user_id BIGINT NOT NULL,
  sys_user_name VARCHAR(128) COLLATE utf8mb4_unicode_ci NOT NULL
) ENGINE=MEMORY;

INSERT INTO tmp_oa_employee_uid_map (employee_id, console_uid, sys_user_id, sys_user_name)
SELECT e.employee_id,
       du.uid,
       su.user_id,
       su.user_name
  FROM wizbizdb.wb_employee e
  INNER JOIN wizbizdb.sys_user su
          ON su.user_id = e.user_id
  INNER JOIN hzy_console.directory_users du
          ON du.uid COLLATE utf8mb4_unicode_ci = su.user_name COLLATE utf8mb4_unicode_ci
 WHERE e.employee_id IS NOT NULL
   AND e.user_id IS NOT NULL
   AND su.user_name IS NOT NULL
   AND su.user_name <> ''
   AND du.status = 'active';

-- 手工确认的历史员工映射：
--   365 陈重重 -> chenzhongzhong
--   378 王晓明 -> zhouguangying
--   408 叶忠义 -> zhouguangying
-- 这些 OA 员工记录没有 wb_employee.user_id，无法通过 sys_user 自动映射。
INSERT INTO tmp_oa_employee_uid_map (employee_id, console_uid, sys_user_id, sys_user_name)
SELECT manual.employee_id,
       du.uid,
       0 AS sys_user_id,
       du.uid AS sys_user_name
  FROM (
    SELECT 365 AS employee_id, 'chenzhongzhong' AS uid
    UNION ALL SELECT 378, 'zhouguangying'
    UNION ALL SELECT 408, 'zhouguangying'
  ) manual
  INNER JOIN hzy_console.directory_users du
          ON du.uid COLLATE utf8mb4_unicode_ci = manual.uid COLLATE utf8mb4_unicode_ci
 WHERE du.status = 'active'
ON DUPLICATE KEY UPDATE
  console_uid = VALUES(console_uid),
  sys_user_id = VALUES(sys_user_id),
  sys_user_name = VALUES(sys_user_name);

-- 迁移前核查：仍为数字且可映射/不可映射的数量。
SELECT 'before_customer_owner' AS scope,
       COUNT(*) AS numeric_rows,
       SUM(m.console_uid IS NOT NULL) AS mappable_rows,
       SUM(m.console_uid IS NULL) AS unmapped_rows
  FROM customer c
  LEFT JOIN tmp_oa_employee_uid_map m
         ON m.employee_id = CAST(c.owner_user_id AS UNSIGNED)
 WHERE c.owner_user_id REGEXP '^[0-9]+$';

SELECT 'before_contract_owner' AS scope,
       COUNT(*) AS numeric_rows,
       SUM(m.console_uid IS NOT NULL) AS mappable_rows,
       SUM(m.console_uid IS NULL) AS unmapped_rows
  FROM contract c
  LEFT JOIN tmp_oa_employee_uid_map m
         ON m.employee_id = CAST(c.owner_user_id AS UNSIGNED)
 WHERE c.owner_user_id REGEXP '^[0-9]+$';

-- 客户负责人：OA employee_id -> Console uid
UPDATE customer c
INNER JOIN tmp_oa_employee_uid_map m
        ON m.employee_id = CAST(c.owner_user_id AS UNSIGNED)
   SET c.owner_user_id = m.console_uid
 WHERE c.owner_user_id REGEXP '^[0-9]+$';

-- 合同负责人：OA employee_id -> Console uid
UPDATE contract c
INNER JOIN tmp_oa_employee_uid_map m
        ON m.employee_id = CAST(c.owner_user_id AS UNSIGNED)
   SET c.owner_user_id = m.console_uid
 WHERE c.owner_user_id REGEXP '^[0-9]+$';

-- 迁移后核查：应只剩无法通过 employee_id -> user_name -> uid 映射的数字值。
SELECT 'after_customer_owner_unmapped' AS scope,
       c.owner_user_id AS legacy_employee_id,
       COUNT(*) AS rows_count
  FROM customer c
 WHERE c.owner_user_id REGEXP '^[0-9]+$'
 GROUP BY c.owner_user_id
 ORDER BY rows_count DESC, legacy_employee_id;

SELECT 'after_contract_owner_unmapped' AS scope,
       c.owner_user_id AS legacy_employee_id,
       COUNT(*) AS rows_count
  FROM contract c
 WHERE c.owner_user_id REGEXP '^[0-9]+$'
 GROUP BY c.owner_user_id
 ORDER BY rows_count DESC, legacy_employee_id;

DROP TEMPORARY TABLE IF EXISTS tmp_oa_employee_uid_map;
