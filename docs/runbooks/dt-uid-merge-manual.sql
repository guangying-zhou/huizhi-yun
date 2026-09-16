-- dt-* 主体手工归并（单个主体，跨应用引用已确认为零）。
--
-- 适用场景：只有个别遗留主体、且已用 dt-uid-merge-precheck.sql 确认
-- aims / assets / codocs / finance / altoc / workflow 六个业务库零引用。
-- 这种规模下手工执行比走归并接口更直接。
--
-- 本次案例：
--   legacy    = dt-5a2d907222203e6cae58d183c35c6770
--   canonical = liukai
-- 执行前把下面两处 SET 换成实际值，并填上真实工号。
--
-- 顺序不可颠倒：先停用旧主体切断新引用，再撤销会话，最后迁移事实与重绑身份。
-- 每一段都请单独执行并核对影响行数，不要整段无人值守地跑完。

-- ============================================================
-- 第一部分：Console 库（hzy_console）
-- ============================================================
USE `hzy_console`;

-- 用户变量默认取连接排序规则（MySQL 8+ 是 utf8mb4_0900_ai_ci），而两个库的
-- 表列是 utf8mb4_unicode_ci，直接比较会报 1270/1267 Illegal mix of collations。
-- 每一部分开头都显式对齐连接排序规则。
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

SET @legacy = 'dt-5a2d907222203e6cae58d183c35c6770';
SET @canonical = 'liukai';

-- 0) 前置确认：旧主体不得有在途操作，否则回执会写回一个已停用的主体。
--    必须返回 0 才继续。
SELECT COUNT(*) AS in_flight_operations
FROM `integration_operation`
WHERE `source_biz_code` = @legacy
  AND `status` IN ('pending', 'processing', 'retry_wait', 'partial_unknown');

-- 0b) 确认两个主体的现状。canonical 必须存在且非 deleted。
SELECT `uid`, `username`, `display_name`, `email`, `status`, `primary_dept_code`
FROM `directory_users`
WHERE `uid` IN (@legacy, @canonical);

-- 1) 停用旧主体，切断归并期间可能产生的新引用。
UPDATE `directory_users`
SET `status` = 'inactive', `updated_at` = UTC_TIMESTAMP()
WHERE `uid` = @legacy AND `status` <> 'deleted';

-- 2) 撤销旧主体的刷新令牌与会话，让持有旧身份登录态的浏览器立刻失效。
UPDATE `auth_refresh_tokens` rt
INNER JOIN `local_sessions` ls ON ls.`id` = rt.`session_id`
SET rt.`status` = 'revoked',
    rt.`revoked_at` = COALESCE(rt.`revoked_at`, UTC_TIMESTAMP())
WHERE ls.`uid` = @legacy AND rt.`status` IN ('active', 'rotated');

UPDATE `local_sessions`
SET `status` = 'revoked',
    `revoked_at` = COALESCE(`revoked_at`, UTC_TIMESTAMP()),
    `updated_at` = UTC_TIMESTAMP()
WHERE `uid` = @legacy AND `status` = 'active';

-- 3) 合并部门归属。UPDATE IGNORE：canonical 已有的同部门归属优先保留，
--    冲突行留在旧主体名下，由下一句停用。
UPDATE IGNORE `directory_user_departments`
SET `uid` = @canonical, `updated_at` = UTC_TIMESTAMP()
WHERE `uid` = @legacy;

-- 注意状态取值：本表 CHECK 只允许 active / inactive / deleted，
-- 不是离职语义的 'left'。left_at 只是时间戳列，与状态无关。
UPDATE `directory_user_departments`
SET `status` = 'inactive',
    `left_at` = COALESCE(`left_at`, UTC_TIMESTAMP()),
    `updated_at` = UTC_TIMESTAMP()
WHERE `uid` = @legacy AND `status` <> 'inactive';

-- 4) 重绑钉钉身份。同理，canonical 已绑定同一 provider_subject 时旧行停用，
--    不制造重复绑定。
UPDATE IGNORE `directory_identities`
SET `uid` = @canonical,
    `last_synced_at` = UTC_TIMESTAMP(),
    `updated_at` = UTC_TIMESTAMP()
WHERE `uid` = @legacy AND `status` <> 'deleted';

UPDATE `directory_identities`
SET `status` = 'inactive', `updated_at` = UTC_TIMESTAMP()
WHERE `uid` = @legacy AND `status` <> 'deleted';

-- 5) 同步主体导出投影：旧主体标记为 inactive，canonical 刷新为当前状态。
--    Platform 的授权投影读这张表。
UPDATE `directory_subject_exports`
SET `status` = 'inactive', `updated_at` = UTC_TIMESTAMP()
WHERE `subject_type` = 'user' AND `subject_code` = @legacy;

INSERT INTO `directory_subject_exports`
  (`subject_type`, `subject_code`, `external_ref`, `parent_subject_type`, `parent_subject_code`,
   `source_object_type`, `source_object_code`, `snapshot_hash`, `status`, `exported_at`, `created_at`, `updated_at`)
SELECT 'user', u.`uid`, SHA2(CONCAT('console:user:', u.`uid`), 256),
       CASE WHEN pd.dept_code IS NULL THEN NULL ELSE 'department' END, pd.dept_code,
       'directory_users', u.`uid`,
       SHA2(CONCAT_WS('|', 'user', u.`uid`, COALESCE(pd.dept_code, ''), u.`status`), 256),
       CASE WHEN u.`status` = 'pending' THEN 'inactive' ELSE u.`status` END,
       UTC_TIMESTAMP(), UTC_TIMESTAMP(), UTC_TIMESTAMP()
FROM `directory_users` u
LEFT JOIN (
  SELECT ranked.uid, ranked.dept_code FROM (
    SELECT ud.`uid`, ud.`dept_code`, ROW_NUMBER() OVER (
      PARTITION BY ud.`uid` ORDER BY ud.`is_primary` DESC, d.`sort_order` ASC, d.`id` ASC, ud.`id` ASC
    ) AS row_no
    FROM `directory_user_departments` ud
    INNER JOIN `directory_departments` d ON d.`dept_code` = ud.`dept_code`
    WHERE ud.`status` = 'active' AND ud.`relation_type` = 'member'
      AND d.`status` = 'active' AND d.`org_type` = 'department'
  ) ranked WHERE ranked.row_no = 1
) pd ON pd.uid = u.`uid`
WHERE u.`uid` = @canonical
ON DUPLICATE KEY UPDATE
  `external_ref` = VALUES(`external_ref`),
  `parent_subject_type` = VALUES(`parent_subject_type`),
  `parent_subject_code` = VALUES(`parent_subject_code`),
  `snapshot_hash` = VALUES(`snapshot_hash`),
  `status` = VALUES(`status`),
  `exported_at` = VALUES(`exported_at`),
  `updated_at` = VALUES(`updated_at`);

-- 6) 核对结果：旧主体应为 inactive 且无 active 身份；canonical 应持有钉钉身份。
SELECT `uid`, `status` FROM `directory_users` WHERE `uid` IN (@legacy, @canonical);
SELECT `uid`, `provider_code`, `provider_subject`, `status`
FROM `directory_identities` WHERE `uid` IN (@legacy, @canonical);


-- ============================================================
-- 第二部分：People 库（hzy_people）
-- ============================================================
USE `hzy_people`;

-- 用户变量默认取连接排序规则（MySQL 8+ 是 utf8mb4_0900_ai_ci），而两个库的
-- 表列是 utf8mb4_unicode_ci，直接比较会报 1270/1267 Illegal mix of collations。
-- 每一部分开头都显式对齐连接排序规则。
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

SET @legacy = 'dt-5a2d907222203e6cae58d183c35c6770';
SET @canonical = 'liukai';
-- 钉钉当时未下发工号时，employee_no 会退化成合成 UID，必须一并修复。
-- 先看当前值，再决定下面填什么。
SET @employee_no = 'REPLACE_WITH_REAL_EMPLOYEE_NO';

SELECT `employee_uid`, `employee_no`, `display_name`, `login_name`, `employment_status`
FROM `people_employees` WHERE `employee_uid` IN (@legacy, @canonical);

-- canonical 必须尚无员工行。若返回非 0，说明同一个人有两份独立任职事实，
-- 合并口径需要人工判定，不要继续往下执行。
SELECT COUNT(*) AS canonical_employee_exists
FROM `people_employees` WHERE `employee_uid` = @canonical;

-- people_employees.employee_uid 被 4 张子表外键引用，直接改父行会报 1451。
-- 在同一事务内临时关闭外键检查，改完立即恢复并校验。
SET @previous_fk_checks = @@SESSION.foreign_key_checks;
SET SESSION foreign_key_checks = 0;
START TRANSACTION;

UPDATE `people_employees`
SET `employee_uid` = @canonical,
    `employee_no` = @employee_no,
    `login_name` = @canonical,
    `updated_at` = NOW()
WHERE `employee_uid` = @legacy;

UPDATE `people_assignments` SET `employee_uid` = @canonical WHERE `employee_uid` = @legacy;
UPDATE `people_directory_lifecycle_versions` SET `employee_uid` = @canonical WHERE `employee_uid` = @legacy;

-- 以下几张表本次核查为 0 行，一并执行以防遗漏；影响 0 行属正常。
UPDATE `people_cost_snapshots` SET `employee_uid` = @canonical WHERE `employee_uid` = @legacy;
UPDATE `people_contribution_snapshots` SET `employee_uid` = @canonical WHERE `employee_uid` = @legacy;
UPDATE `people_documents` SET `employee_uid` = @canonical WHERE `employee_uid` = @legacy;
UPDATE `people_offboarding_cases` SET `employee_uid` = @canonical WHERE `employee_uid` = @legacy;
UPDATE `people_employees` SET `manager_uid` = @canonical WHERE `manager_uid` = @legacy;
UPDATE `people_assignments` SET `manager_uid` = @canonical WHERE `manager_uid` = @legacy;
UPDATE `people_offboarding_tasks` SET `responsible_uid` = @canonical WHERE `responsible_uid` = @legacy;

COMMIT;
SET SESSION foreign_key_checks = @previous_fk_checks;

-- 校验外键完整性：以下两条都必须返回 0。
SELECT COUNT(*) AS orphan_assignments
FROM `people_assignments` a
LEFT JOIN `people_employees` e ON e.`employee_uid` = a.`employee_uid`
WHERE e.`employee_uid` IS NULL;

SELECT COUNT(*) AS remaining_legacy_rows
FROM `people_employees` WHERE `employee_uid` = @legacy;

-- 结果核对
SELECT `employee_uid`, `employee_no`, `display_name`, `login_name`, `employment_status`
FROM `people_employees` WHERE `employee_uid` = @canonical;


-- ============================================================
-- 第三部分：归并后验证
-- ============================================================
-- 1. 用 dt-uid-merge-precheck.sql 在 hzy_people 上重跑，命中应只剩审计列
--    （created_by / updated_by / original_actor_uid 等保留历史事实，不改写）。
-- 2. 触发一次钉钉 HR 同步，确认不再产生新的 dt-*，且该员工指向 canonical UID。
-- 3. 让该员工用 LDAP 账号登录一次，确认目录与授权都已指向 canonical 主体。
