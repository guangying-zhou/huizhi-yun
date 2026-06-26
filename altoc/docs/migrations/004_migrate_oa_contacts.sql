-- ============================================================
-- Migration 004: 迁移 OA 客户联系人到 Altoc contact
-- ============================================================
-- 背景：
--   当前 hzy_altoc.customer 已迁入 OA 客户，编码规则为 CUMIG{wizbizdb.wb_organization.org_id}。
--   本脚本将 wizbizdb.wb_contactman 中能挂到客户的联系人迁入 hzy_altoc.contact。
--
-- 幂等性：
--   使用 contact.legacy_source + contact.legacy_id 对应 wizbizdb.wb_contactman.contactman_id。
--   重复执行会更新已迁移联系人，不会重复插入。
--
-- 未迁移范围：
--   wb_contactman.org_id 为空或无法通过 CUMIG{org_id} 找到客户的联系人不会迁入，
--   避免把联系人挂到错误客户。

USE hzy_altoc;

-- ------------------------------------------------------------
-- 1. 补齐联系人迁移兼容字段
-- ------------------------------------------------------------
SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = 'hzy_altoc' AND TABLE_NAME = 'contact' AND COLUMN_NAME = 'alternate_mobile') = 0,
  'ALTER TABLE contact ADD COLUMN alternate_mobile VARCHAR(30) DEFAULT NULL COMMENT ''备用手机号'' AFTER mobile',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = 'hzy_altoc' AND TABLE_NAME = 'contact' AND COLUMN_NAME = 'mailing_address') = 0,
  'ALTER TABLE contact ADD COLUMN mailing_address VARCHAR(500) DEFAULT NULL COMMENT ''快递/联系地址'' AFTER wechat',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = 'hzy_altoc' AND TABLE_NAME = 'contact' AND COLUMN_NAME = 'star_level') = 0,
  'ALTER TABLE contact ADD COLUMN star_level INT DEFAULT NULL COMMENT ''源系统星级编码'' AFTER mailing_address',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = 'hzy_altoc' AND TABLE_NAME = 'contact' AND COLUMN_NAME = 'legacy_source') = 0,
  'ALTER TABLE contact ADD COLUMN legacy_source VARCHAR(50) DEFAULT NULL COMMENT ''迁移来源系统'' AFTER owner_user_id',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = 'hzy_altoc' AND TABLE_NAME = 'contact' AND COLUMN_NAME = 'legacy_id') = 0,
  'ALTER TABLE contact ADD COLUMN legacy_id BIGINT DEFAULT NULL COMMENT ''迁移来源主键'' AFTER legacy_source',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = 'hzy_altoc' AND TABLE_NAME = 'contact' AND INDEX_NAME = 'uk_contact_legacy') = 0,
  'ALTER TABLE contact ADD UNIQUE KEY uk_contact_legacy (legacy_source, legacy_id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ------------------------------------------------------------
-- 2. 构建 OA 员工/操作员到 Console uid 的临时映射
-- ------------------------------------------------------------
DROP TEMPORARY TABLE IF EXISTS tmp_oa_employee_uid_map;
CREATE TEMPORARY TABLE tmp_oa_employee_uid_map (
  employee_id BIGINT PRIMARY KEY,
  console_uid VARCHAR(128) COLLATE utf8mb4_unicode_ci NOT NULL
) ENGINE=MEMORY;

INSERT INTO tmp_oa_employee_uid_map (employee_id, console_uid)
SELECT e.employee_id,
       du.uid
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

INSERT INTO tmp_oa_employee_uid_map (employee_id, console_uid)
SELECT manual.employee_id,
       du.uid
  FROM (
    SELECT 365 AS employee_id, 'chenzhongzhong' AS uid
    UNION ALL SELECT 378, 'zhouguangying'
    UNION ALL SELECT 408, 'zhouguangying'
  ) manual
  INNER JOIN hzy_console.directory_users du
          ON du.uid COLLATE utf8mb4_unicode_ci = manual.uid COLLATE utf8mb4_unicode_ci
 WHERE du.status = 'active'
ON DUPLICATE KEY UPDATE console_uid = VALUES(console_uid);

DROP TEMPORARY TABLE IF EXISTS tmp_oa_sys_user_uid_map;
CREATE TEMPORARY TABLE tmp_oa_sys_user_uid_map (
  user_id BIGINT PRIMARY KEY,
  console_uid VARCHAR(128) COLLATE utf8mb4_unicode_ci NOT NULL
) ENGINE=MEMORY;

INSERT INTO tmp_oa_sys_user_uid_map (user_id, console_uid)
SELECT su.user_id,
       du.uid
  FROM wizbizdb.sys_user su
  INNER JOIN hzy_console.directory_users du
          ON du.uid COLLATE utf8mb4_unicode_ci = su.user_name COLLATE utf8mb4_unicode_ci
 WHERE su.user_id IS NOT NULL
   AND su.user_name IS NOT NULL
   AND su.user_name <> ''
   AND du.status = 'active';

-- ------------------------------------------------------------
-- 3. 迁移前核查
-- ------------------------------------------------------------
SELECT 'before_oa_contact' AS scope,
       COUNT(*) AS source_rows,
       SUM(c.id IS NOT NULL) AS mappable_rows,
       SUM(c.id IS NULL) AS unmapped_rows
  FROM wizbizdb.wb_contactman cm
  LEFT JOIN customer c
         ON c.code = CONCAT('CUMIG', cm.org_id);

SELECT 'before_altoc_contact' AS scope,
       COUNT(*) AS total_rows,
       SUM(legacy_source = 'wizbizdb') AS migrated_rows
  FROM contact;

-- ------------------------------------------------------------
-- 4. 插入/更新联系人
-- ------------------------------------------------------------
INSERT INTO contact (
  customer_id,
  name,
  gender,
  dept_name,
  job_title,
  mobile,
  alternate_mobile,
  phone,
  email,
  wechat,
  mailing_address,
  star_level,
  decision_role,
  influence_level,
  is_key_contact,
  status,
  owner_user_id,
  legacy_source,
  legacy_id,
  remark,
  created_by,
  updated_by,
  created_at,
  updated_at,
  deleted_at
)
SELECT c.id AS customer_id,
       TRIM(cm.cm_name) AS name,
       0 AS gender,
       NULLIF(TRIM(cm.department), '') AS dept_name,
       NULLIF(TRIM(cm.post), '') AS job_title,
       NULLIF(TRIM(cm.mobile), '') AS mobile,
       NULLIF(TRIM(cm.mobile2), '') AS alternate_mobile,
       NULLIF(TRIM(cm.phone), '') AS phone,
       NULL AS email,
       NULLIF(TRIM(cm.weixin_number), '') AS wechat,
       NULLIF(TRIM(cm.address), '') AS mailing_address,
       cm.stars AS star_level,
       NULL AS decision_role,
       NULL AS influence_level,
       0 AS is_key_contact,
       'active' AS status,
       COALESCE(owner_map.console_uid, c.owner_user_id, 'zhouguangying') AS owner_user_id,
       'wizbizdb' AS legacy_source,
       cm.contactman_id AS legacy_id,
       NULLIF(TRIM(cm.remarks), '') AS remark,
       COALESCE(operator_map.console_uid, owner_map.console_uid, c.owner_user_id, 'zhouguangying') AS created_by,
       COALESCE(operator_map.console_uid, owner_map.console_uid, c.owner_user_id, 'zhouguangying') AS updated_by,
       COALESCE(cm.operate_time, CURRENT_TIMESTAMP) AS created_at,
       COALESCE(cm.operate_time, CURRENT_TIMESTAMP) AS updated_at,
       NULL AS deleted_at
  FROM wizbizdb.wb_contactman cm
  INNER JOIN customer c
          ON c.code = CONCAT('CUMIG', cm.org_id)
  LEFT JOIN tmp_oa_employee_uid_map owner_map
         ON owner_map.employee_id = cm.employee_id
  LEFT JOIN tmp_oa_sys_user_uid_map operator_map
         ON operator_map.user_id = cm.operator_id
 WHERE cm.contactman_id IS NOT NULL
   AND cm.cm_name IS NOT NULL
   AND TRIM(cm.cm_name) <> ''
ON DUPLICATE KEY UPDATE
  customer_id = VALUES(customer_id),
  name = VALUES(name),
  dept_name = VALUES(dept_name),
  job_title = VALUES(job_title),
  mobile = VALUES(mobile),
  alternate_mobile = VALUES(alternate_mobile),
  phone = VALUES(phone),
  wechat = VALUES(wechat),
  mailing_address = VALUES(mailing_address),
  star_level = VALUES(star_level),
  status = VALUES(status),
  owner_user_id = VALUES(owner_user_id),
  remark = VALUES(remark),
  updated_by = VALUES(updated_by),
  updated_at = VALUES(updated_at),
  deleted_at = VALUES(deleted_at);

-- ------------------------------------------------------------
-- 5. 迁移后核查
-- ------------------------------------------------------------
SELECT 'after_altoc_contact' AS scope,
       COUNT(*) AS total_rows,
       SUM(legacy_source = 'wizbizdb') AS migrated_rows
  FROM contact;

SELECT 'after_oa_contact_unmapped_org' AS scope,
       COUNT(*) AS unmapped_rows
  FROM wizbizdb.wb_contactman cm
  LEFT JOIN customer c
         ON c.code = CONCAT('CUMIG', cm.org_id)
 WHERE c.id IS NULL;

SELECT 'after_contact_owner_unmapped_numeric' AS scope,
       owner_user_id,
       COUNT(*) AS rows_count
  FROM contact
 WHERE owner_user_id REGEXP '^[0-9]+$'
 GROUP BY owner_user_id
 ORDER BY rows_count DESC, owner_user_id;

DROP TEMPORARY TABLE IF EXISTS tmp_oa_employee_uid_map;
DROP TEMPORARY TABLE IF EXISTS tmp_oa_sys_user_uid_map;
