-- ============================================================
-- hzy_console v1 Account -> Console Directory Runtime migration
-- Source DB: hzy_account
-- Target DB: hzy_console
--
-- Purpose:
--   Copy Account directory data into Console directory-runtime tables.
--   This script is designed as a repeatable mirror import:
--   - It does not modify hzy_account.
--   - It upserts directory master data by stable codes.
--   - It refreshes Account-sourced relation rows as active/inactive mirrors.
--   - It rebuilds directory_subject_exports with minimal non-PII projection.
--
-- Prerequisites:
--   1. Run docs/Console-SQL-DDL-Draft-v1.sql, or equivalent Console schema.
--   2. hzy_account and hzy_console are on the same MySQL instance.
--   3. If Account contains multiple companies, set @account_company_code before running.
--
-- Optional override:
--   SET @account_company_code := 'C000001';
-- ============================================================

USE `hzy_console`;

-- MySQL 8 clients such as Workbench often default to utf8mb4_0900_ai_ci.
-- Console/Account schemas use utf8mb4_unicode_ci; keep literals and user variables aligned.
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

SET @migration_started_at := NOW();
SET @account_company_code := COALESCE(
  NULLIF(CONVERT(@account_company_code USING utf8mb4) COLLATE utf8mb4_unicode_ci, ''),
  (SELECT `tenant_code` FROM `org_profiles` WHERE `singleton_key` = 1 LIMIT 1)
);
SET @job_code := CONVERT(
  CONCAT('account-migration-', DATE_FORMAT(@migration_started_at, '%Y%m%d%H%i%s'))
  USING utf8mb4
) COLLATE utf8mb4_unicode_ci;

START TRANSACTION;

INSERT INTO `directory_sync_jobs` (
  `job_code`,
  `provider_code`,
  `sync_type`,
  `object_scope`,
  `status`,
  `started_at`,
  `requested_by`,
  `created_at`,
  `updated_at`
) VALUES (
  @job_code,
  'account',
  'manual',
  'all',
  'running',
  @migration_started_at,
  'migration:account-to-console',
  @migration_started_at,
  @migration_started_at
);

-- ------------------------------------------------------------
-- 1. Departments
-- ------------------------------------------------------------

INSERT INTO `directory_departments` (
  `dept_code`,
  `dept_name`,
  `parent_id`,
  `parent_dept_code`,
  `dept_path`,
  `level_no`,
  `sort_order`,
  `manager_uid`,
  `leader_uid`,
  `org_type`,
  `dept_category`,
  `description`,
  `source_provider`,
  `external_ref`,
  `source_payload_hash`,
  `synced_at`,
  `status`,
  `created_at`,
  `updated_at`
)
SELECT
  d.`dept_code`,
  d.`name`,
  NULL,
  pd.`dept_code`,
  d.`path`,
  COALESCE(d.`level`, 1),
  COALESCE(d.`sort_order`, 100),
  NULLIF(d.`manager_uid`, ''),
  NULLIF(d.`leader_uid`, ''),
  COALESCE(NULLIF(d.`org_type`, ''), 'department'),
  CASE d.`dept_category`
    WHEN 1 THEN 'administrative'
    WHEN 2 THEN 'business_support'
    WHEN 3 THEN 'business'
    WHEN 4 THEN 'management'
    ELSE NULL
  END,
  d.`description`,
  'account',
  CONCAT('account:departments:', d.`id`),
  SHA2(CONCAT_WS('|',
    d.`dept_code`,
    d.`name`,
    COALESCE(pd.`dept_code`, ''),
    COALESCE(d.`path`, ''),
    COALESCE(d.`level`, 1),
    COALESCE(d.`sort_order`, 100),
    COALESCE(d.`manager_uid`, ''),
    COALESCE(d.`leader_uid`, ''),
    COALESCE(d.`org_type`, 'department'),
    COALESCE(d.`dept_category`, ''),
    COALESCE(d.`status`, 1)
  ), 256),
  @migration_started_at,
  CASE d.`status`
    WHEN 1 THEN 'active'
    WHEN 0 THEN 'inactive'
    ELSE 'deleted'
  END,
  COALESCE(d.`created_at`, @migration_started_at),
  COALESCE(d.`updated_at`, @migration_started_at)
FROM `hzy_account`.`departments` d
LEFT JOIN `hzy_account`.`departments` pd ON pd.`id` = d.`parent_id`
WHERE (@account_company_code IS NULL OR d.`company_code` IS NULL OR d.`company_code` = @account_company_code)
ON DUPLICATE KEY UPDATE
  `dept_name` = VALUES(`dept_name`),
  `parent_dept_code` = VALUES(`parent_dept_code`),
  `dept_path` = VALUES(`dept_path`),
  `level_no` = VALUES(`level_no`),
  `sort_order` = VALUES(`sort_order`),
  `manager_uid` = VALUES(`manager_uid`),
  `leader_uid` = VALUES(`leader_uid`),
  `org_type` = VALUES(`org_type`),
  `dept_category` = VALUES(`dept_category`),
  `description` = VALUES(`description`),
  `source_provider` = VALUES(`source_provider`),
  `external_ref` = VALUES(`external_ref`),
  `source_payload_hash` = VALUES(`source_payload_hash`),
  `synced_at` = VALUES(`synced_at`),
  `status` = VALUES(`status`),
  `updated_at` = VALUES(`updated_at`);

UPDATE `directory_departments` child
LEFT JOIN `directory_departments` parent
  ON parent.`dept_code` = child.`parent_dept_code`
SET child.`parent_id` = parent.`id`
WHERE child.`source_provider` = 'account';

-- ------------------------------------------------------------
-- 2. Users
-- ------------------------------------------------------------

INSERT INTO `directory_users` (
  `uid`,
  `username`,
  `display_name`,
  `real_name`,
  `nickname`,
  `avatar_url`,
  `email`,
  `mobile`,
  `mobile_tail4`,
  `position_title`,
  `gender`,
  `timezone`,
  `locale`,
  `primary_dept_code`,
  `user_type`,
  `source_provider`,
  `external_ref`,
  `source_payload_hash`,
  `last_login_at`,
  `last_login_ip`,
  `synced_at`,
  `status`,
  `remark`,
  `created_at`,
  `updated_at`
)
SELECT
  su.`uid`,
  su.`uid`,
  COALESCE(NULLIF(su.`real_name`, ''), NULLIF(su.`nickname`, ''), su.`uid`),
  NULLIF(su.`real_name`, ''),
  NULLIF(su.`nickname`, ''),
  NULLIF(su.`avatar`, ''),
  NULLIF(su.`email`, ''),
  NULLIF(su.`mobile`, ''),
  CASE
    WHEN su.`mobile` IS NULL OR su.`mobile` = '' THEN NULL
    ELSE RIGHT(su.`mobile`, 4)
  END,
  NULLIF(su.`position`, ''),
  CASE su.`gender`
    WHEN 1 THEN 'male'
    WHEN 2 THEN 'female'
    ELSE 'unknown'
  END,
  COALESCE(NULLIF(su.`timezone`, ''), 'Asia/Shanghai'),
  COALESCE(NULLIF(su.`language`, ''), 'zh-CN'),
  dd.`dept_code`,
  CASE su.`user_type`
    WHEN 0 THEN 'system'
    WHEN 2 THEN 'external'
    ELSE 'employee'
  END,
  'account',
  CONCAT('account:system_users:', su.`id`),
  SHA2(CONCAT_WS('|',
    su.`uid`,
    COALESCE(su.`real_name`, ''),
    COALESCE(su.`nickname`, ''),
    COALESCE(su.`avatar`, ''),
    COALESCE(su.`email`, ''),
    COALESCE(su.`mobile`, ''),
    COALESCE(su.`position`, ''),
    COALESCE(su.`dept_code`, ''),
    COALESCE(su.`user_type`, 1),
    COALESCE(su.`status`, 1)
  ), 256),
  su.`last_login_at`,
  NULLIF(su.`last_login_ip`, ''),
  @migration_started_at,
  CASE su.`status`
    WHEN 1 THEN 'active'
    WHEN 0 THEN 'inactive'
    WHEN -1 THEN 'deleted'
    ELSE 'inactive'
  END,
  NULLIF(su.`remark`, ''),
  COALESCE(su.`created_at`, @migration_started_at),
  COALESCE(su.`updated_at`, @migration_started_at)
FROM `hzy_account`.`system_users` su
LEFT JOIN `directory_departments` dd ON dd.`dept_code` = su.`dept_code` AND dd.`org_type` = 'department'
WHERE (@account_company_code IS NULL OR su.`company_code` IS NULL OR su.`company_code` = @account_company_code)
ON DUPLICATE KEY UPDATE
  `username` = VALUES(`username`),
  `display_name` = VALUES(`display_name`),
  `real_name` = VALUES(`real_name`),
  `nickname` = VALUES(`nickname`),
  `avatar_url` = VALUES(`avatar_url`),
  `email` = VALUES(`email`),
  `mobile` = VALUES(`mobile`),
  `mobile_tail4` = VALUES(`mobile_tail4`),
  `position_title` = VALUES(`position_title`),
  `gender` = VALUES(`gender`),
  `timezone` = VALUES(`timezone`),
  `locale` = VALUES(`locale`),
  `primary_dept_code` = VALUES(`primary_dept_code`),
  `user_type` = VALUES(`user_type`),
  `source_provider` = VALUES(`source_provider`),
  `external_ref` = VALUES(`external_ref`),
  `source_payload_hash` = VALUES(`source_payload_hash`),
  `last_login_at` = VALUES(`last_login_at`),
  `last_login_ip` = VALUES(`last_login_ip`),
  `synced_at` = VALUES(`synced_at`),
  `status` = VALUES(`status`),
  `remark` = VALUES(`remark`),
  `updated_at` = VALUES(`updated_at`);

-- Migrate platform users that do not already have a system_users profile.
INSERT INTO `directory_users` (
  `uid`,
  `username`,
  `display_name`,
  `real_name`,
  `avatar_url`,
  `email`,
  `mobile`,
  `mobile_tail4`,
  `user_type`,
  `source_provider`,
  `external_ref`,
  `source_payload_hash`,
  `last_login_at`,
  `last_login_ip`,
  `synced_at`,
  `status`,
  `created_at`,
  `updated_at`
)
SELECT
  pu.`username`,
  pu.`username`,
  COALESCE(NULLIF(pu.`real_name`, ''), pu.`username`),
  NULLIF(pu.`real_name`, ''),
  NULLIF(pu.`avatar`, ''),
  NULLIF(pu.`email`, ''),
  NULLIF(pu.`mobile`, ''),
  CASE
    WHEN pu.`mobile` IS NULL OR pu.`mobile` = '' THEN NULL
    ELSE RIGHT(pu.`mobile`, 4)
  END,
  'employee',
  'account',
  CONCAT('account:platform_users:', pu.`id`),
  SHA2(CONCAT_WS('|',
    pu.`username`,
    COALESCE(pu.`real_name`, ''),
    COALESCE(pu.`avatar`, ''),
    COALESCE(pu.`email`, ''),
    COALESCE(pu.`mobile`, ''),
    COALESCE(pu.`status`, 1)
  ), 256),
  pu.`last_login_at`,
  NULLIF(pu.`last_login_ip`, ''),
  @migration_started_at,
  CASE pu.`status`
    WHEN 1 THEN 'active'
    WHEN 0 THEN 'inactive'
    WHEN -1 THEN 'deleted'
    ELSE 'inactive'
  END,
  COALESCE(pu.`created_at`, @migration_started_at),
  COALESCE(pu.`updated_at`, @migration_started_at)
FROM `hzy_account`.`platform_users` pu
LEFT JOIN `hzy_account`.`system_users` su ON su.`platform_user_id` = pu.`id`
WHERE su.`id` IS NULL
  AND pu.`username` IS NOT NULL
  AND pu.`username` <> ''
  AND NOT EXISTS (
    SELECT 1
    FROM `hzy_account`.`system_users` su_uid
    WHERE su_uid.`uid` = pu.`username`
  )
  AND (@account_company_code IS NULL OR pu.`company_code` IS NULL OR pu.`company_code` = @account_company_code)
ON DUPLICATE KEY UPDATE
  `username` = VALUES(`username`),
  `display_name` = VALUES(`display_name`),
  `real_name` = VALUES(`real_name`),
  `avatar_url` = VALUES(`avatar_url`),
  `email` = VALUES(`email`),
  `mobile` = VALUES(`mobile`),
  `mobile_tail4` = VALUES(`mobile_tail4`),
  `source_provider` = VALUES(`source_provider`),
  `external_ref` = VALUES(`external_ref`),
  `source_payload_hash` = VALUES(`source_payload_hash`),
  `last_login_at` = VALUES(`last_login_at`),
  `last_login_ip` = VALUES(`last_login_ip`),
  `synced_at` = VALUES(`synced_at`),
  `status` = VALUES(`status`),
  `updated_at` = VALUES(`updated_at`);

-- ------------------------------------------------------------
-- 3. User-department memberships
-- ------------------------------------------------------------

UPDATE `directory_user_departments`
SET `status` = 'inactive',
    `left_at` = COALESCE(`left_at`, @migration_started_at),
    `updated_at` = @migration_started_at
WHERE `source_provider` = 'account';

INSERT INTO `directory_user_departments` (
  `uid`,
  `dept_code`,
  `relation_type`,
  `is_primary`,
  `source_provider`,
  `external_ref`,
  `joined_at`,
  `left_at`,
  `status`,
  `created_at`,
  `updated_at`
)
SELECT
  ud.`uid`,
  ud.`dept_code`,
  'member',
  CASE WHEN su.`dept_code` = ud.`dept_code` AND dd.`org_type` = 'department' THEN 1 ELSE 0 END,
  'account',
  CONCAT('account:user_departments:', ud.`id`),
  COALESCE(ud.`created_at`, @migration_started_at),
  NULL,
  'active',
  COALESCE(ud.`created_at`, @migration_started_at),
  @migration_started_at
FROM `hzy_account`.`user_departments` ud
INNER JOIN `directory_users` du ON du.`uid` = ud.`uid`
INNER JOIN `directory_departments` dd ON dd.`dept_code` = ud.`dept_code`
LEFT JOIN `hzy_account`.`system_users` su ON su.`uid` = ud.`uid`
WHERE (@account_company_code IS NULL OR su.`company_code` IS NULL OR su.`company_code` = @account_company_code)
ON DUPLICATE KEY UPDATE
  `is_primary` = VALUES(`is_primary`),
  `external_ref` = VALUES(`external_ref`),
  `joined_at` = VALUES(`joined_at`),
  `left_at` = NULL,
  `status` = 'active',
  `updated_at` = VALUES(`updated_at`);

-- Ensure primary department from system_users exists even if user_departments is incomplete.
INSERT INTO `directory_user_departments` (
  `uid`,
  `dept_code`,
  `relation_type`,
  `is_primary`,
  `source_provider`,
  `external_ref`,
  `joined_at`,
  `left_at`,
  `status`,
  `created_at`,
  `updated_at`
)
SELECT
  su.`uid`,
  su.`dept_code`,
  'member',
  1,
  'account',
  CONCAT('account:system_users:', su.`id`, ':primary_dept'),
  COALESCE(su.`created_at`, @migration_started_at),
  NULL,
  'active',
  COALESCE(su.`created_at`, @migration_started_at),
  @migration_started_at
FROM `hzy_account`.`system_users` su
INNER JOIN `directory_users` du ON du.`uid` = su.`uid`
INNER JOIN `directory_departments` dd ON dd.`dept_code` = su.`dept_code` AND dd.`org_type` = 'department'
WHERE su.`dept_code` IS NOT NULL
  AND su.`dept_code` <> ''
  AND (@account_company_code IS NULL OR su.`company_code` IS NULL OR su.`company_code` = @account_company_code)
ON DUPLICATE KEY UPDATE
  `is_primary` = 1,
  `left_at` = NULL,
  `status` = 'active',
  `updated_at` = VALUES(`updated_at`);

-- Keep only one active member relation to an org_type=department node per user.
-- Other active committee/virtual memberships are preserved.
UPDATE `directory_user_departments` dud
INNER JOIN `directory_departments` dd ON dd.`dept_code` = dud.`dept_code`
LEFT JOIN (
  SELECT keep_rows.`id`
  FROM (
    SELECT
      ranked.`id`,
      ranked.row_no
    FROM (
      SELECT
        dud_inner.`id`,
        ROW_NUMBER() OVER (
          PARTITION BY dud_inner.`uid`
          ORDER BY dud_inner.`is_primary` DESC, dd_inner.`sort_order` ASC, dd_inner.`id` ASC, dud_inner.`id` ASC
        ) AS row_no
      FROM `directory_user_departments` dud_inner
      INNER JOIN `directory_departments` dd_inner ON dd_inner.`dept_code` = dud_inner.`dept_code`
      WHERE dud_inner.`source_provider` = 'account'
        AND dud_inner.`status` = 'active'
        AND dud_inner.`relation_type` = 'member'
        AND dd_inner.`status` = 'active'
        AND dd_inner.`org_type` = 'department'
    ) ranked
    WHERE ranked.row_no = 1
  ) keep_rows
) keep_row ON keep_row.`id` = dud.`id`
SET dud.`is_primary` = 0,
    dud.`status` = 'inactive',
    dud.`left_at` = COALESCE(dud.`left_at`, @migration_started_at),
    dud.`updated_at` = @migration_started_at
WHERE dud.`source_provider` = 'account'
  AND dud.`status` = 'active'
  AND dud.`relation_type` = 'member'
  AND dd.`status` = 'active'
  AND dd.`org_type` = 'department'
  AND keep_row.`id` IS NULL;

-- Derive directory_users.primary_dept_code from the active member relation to an org_type=department node.
-- Committee and virtual organization memberships remain in directory_user_departments only.
UPDATE `directory_users` du
LEFT JOIN (
  SELECT ranked.`uid`, ranked.`dept_code`
  FROM (
    SELECT
      dud.`uid`,
      dud.`dept_code`,
      ROW_NUMBER() OVER (
        PARTITION BY dud.`uid`
        ORDER BY dud.`is_primary` DESC, dd.`sort_order` ASC, dd.`id` ASC, dud.`id` ASC
      ) AS row_no
    FROM `directory_user_departments` dud
    INNER JOIN `directory_departments` dd ON dd.`dept_code` = dud.`dept_code`
    WHERE dud.`status` = 'active'
      AND dud.`relation_type` = 'member'
      AND dd.`status` = 'active'
      AND dd.`org_type` = 'department'
  ) ranked
  WHERE ranked.row_no = 1
) primary_dept ON primary_dept.`uid` = du.`uid`
SET du.`primary_dept_code` = primary_dept.`dept_code`,
    du.`updated_at` = @migration_started_at
WHERE du.`source_provider` = 'account';

INSERT INTO `directory_user_departments` (
  `uid`,
  `dept_code`,
  `relation_type`,
  `is_primary`,
  `source_provider`,
  `external_ref`,
  `joined_at`,
  `left_at`,
  `status`,
  `created_at`,
  `updated_at`
)
SELECT
  d.`manager_uid`,
  d.`dept_code`,
  'manager',
  0,
  'account',
  CONCAT('account:departments:', d.`id`, ':manager'),
  @migration_started_at,
  NULL,
  'active',
  @migration_started_at,
  @migration_started_at
FROM `hzy_account`.`departments` d
INNER JOIN `directory_users` du ON du.`uid` = d.`manager_uid`
INNER JOIN `directory_departments` dd ON dd.`dept_code` = d.`dept_code`
WHERE d.`manager_uid` IS NOT NULL
  AND d.`manager_uid` <> ''
  AND (@account_company_code IS NULL OR d.`company_code` IS NULL OR d.`company_code` = @account_company_code)
ON DUPLICATE KEY UPDATE
  `external_ref` = VALUES(`external_ref`),
  `left_at` = NULL,
  `status` = 'active',
  `updated_at` = VALUES(`updated_at`);

INSERT INTO `directory_user_departments` (
  `uid`,
  `dept_code`,
  `relation_type`,
  `is_primary`,
  `source_provider`,
  `external_ref`,
  `joined_at`,
  `left_at`,
  `status`,
  `created_at`,
  `updated_at`
)
SELECT
  d.`leader_uid`,
  d.`dept_code`,
  'leader',
  0,
  'account',
  CONCAT('account:departments:', d.`id`, ':leader'),
  @migration_started_at,
  NULL,
  'active',
  @migration_started_at,
  @migration_started_at
FROM `hzy_account`.`departments` d
INNER JOIN `directory_users` du ON du.`uid` = d.`leader_uid`
INNER JOIN `directory_departments` dd ON dd.`dept_code` = d.`dept_code`
WHERE d.`leader_uid` IS NOT NULL
  AND d.`leader_uid` <> ''
  AND (@account_company_code IS NULL OR d.`company_code` IS NULL OR d.`company_code` = @account_company_code)
ON DUPLICATE KEY UPDATE
  `external_ref` = VALUES(`external_ref`),
  `left_at` = NULL,
  `status` = 'active',
  `updated_at` = VALUES(`updated_at`);

-- ------------------------------------------------------------
-- 4. Projects and project memberships
-- ------------------------------------------------------------

INSERT INTO `directory_projects` (
  `project_code`,
  `parent_project_code`,
  `project_name`,
  `project_type`,
  `dept_code`,
  `owner_uid`,
  `leader_uid`,
  `repo_url`,
  `description`,
  `source_provider`,
  `external_ref`,
  `source_payload_hash`,
  `synced_at`,
  `status`,
  `created_at`,
  `updated_at`
)
SELECT
  gp.`project_code`,
  NULL,
  gp.`name`,
  CASE
    WHEN gp.`is_template` = 1 THEN 'template'
    WHEN gp.`is_group` = 1 THEN 'group'
    ELSE 'project'
  END,
  dd.`dept_code`,
  NULL,
  du.`uid`,
  NULLIF(gp.`repo_url`, ''),
  gp.`description`,
  'account',
  CONCAT('account:git_projects:', gp.`id`),
  SHA2(CONCAT_WS('|',
    gp.`project_code`,
    COALESCE(gp.`parent_code`, ''),
    gp.`name`,
    COALESCE(gp.`dept_code`, ''),
    COALESCE(gp.`leader_uid`, ''),
    COALESCE(gp.`repo_url`, ''),
    COALESCE(gp.`is_group`, 0),
    COALESCE(gp.`is_template`, 0),
    COALESCE(gp.`status`, 1)
  ), 256),
  @migration_started_at,
  CASE gp.`status`
    WHEN 1 THEN 'active'
    WHEN 0 THEN 'inactive'
    WHEN -1 THEN 'deleted'
    ELSE 'inactive'
  END,
  COALESCE(gp.`created_at`, @migration_started_at),
  COALESCE(gp.`updated_at`, @migration_started_at)
FROM `hzy_account`.`git_projects` gp
LEFT JOIN `directory_departments` dd ON dd.`dept_code` = gp.`dept_code`
LEFT JOIN `directory_users` du ON du.`uid` = gp.`leader_uid`
WHERE (@account_company_code IS NULL OR gp.`company_code` IS NULL OR gp.`company_code` = @account_company_code)
ON DUPLICATE KEY UPDATE
  `project_name` = VALUES(`project_name`),
  `project_type` = VALUES(`project_type`),
  `dept_code` = VALUES(`dept_code`),
  `owner_uid` = VALUES(`owner_uid`),
  `leader_uid` = VALUES(`leader_uid`),
  `repo_url` = VALUES(`repo_url`),
  `description` = VALUES(`description`),
  `source_provider` = VALUES(`source_provider`),
  `external_ref` = VALUES(`external_ref`),
  `source_payload_hash` = VALUES(`source_payload_hash`),
  `synced_at` = VALUES(`synced_at`),
  `status` = VALUES(`status`),
  `updated_at` = VALUES(`updated_at`);

UPDATE `directory_projects` dp
INNER JOIN `hzy_account`.`git_projects` gp ON gp.`project_code` = dp.`project_code`
LEFT JOIN `directory_projects` parent ON parent.`project_code` = gp.`parent_code`
SET dp.`parent_project_code` = parent.`project_code`
WHERE dp.`source_provider` = 'account'
  AND (@account_company_code IS NULL OR gp.`company_code` IS NULL OR gp.`company_code` = @account_company_code);

UPDATE `directory_project_members`
SET `status` = 'inactive',
    `left_at` = COALESCE(`left_at`, @migration_started_at),
    `updated_at` = @migration_started_at
WHERE `source_provider` = 'account';

INSERT INTO `directory_project_members` (
  `project_code`,
  `uid`,
  `member_role`,
  `source_provider`,
  `external_ref`,
  `joined_at`,
  `left_at`,
  `status`,
  `created_at`,
  `updated_at`
)
SELECT
  pm.`project_code`,
  pm.`uid`,
  CASE LOWER(COALESCE(pm.`role`, 'member'))
    WHEN 'admin' THEN 'admin'
    WHEN 'owner' THEN 'owner'
    WHEN 'viewer' THEN 'viewer'
    ELSE 'member'
  END,
  'account',
  CONCAT('account:git_project_members:', pm.`id`),
  COALESCE(pm.`joined_at`, @migration_started_at),
  NULL,
  'active',
  COALESCE(pm.`joined_at`, @migration_started_at),
  @migration_started_at
FROM `hzy_account`.`git_project_members` pm
INNER JOIN `directory_projects` dp ON dp.`project_code` = pm.`project_code`
INNER JOIN `directory_users` du ON du.`uid` = pm.`uid`
LEFT JOIN `hzy_account`.`git_projects` gp ON gp.`project_code` = pm.`project_code`
WHERE (@account_company_code IS NULL OR gp.`company_code` IS NULL OR gp.`company_code` = @account_company_code)
ON DUPLICATE KEY UPDATE
  `member_role` = VALUES(`member_role`),
  `external_ref` = VALUES(`external_ref`),
  `joined_at` = VALUES(`joined_at`),
  `left_at` = NULL,
  `status` = 'active',
  `updated_at` = VALUES(`updated_at`);

-- ------------------------------------------------------------
-- 5. External identities
-- ------------------------------------------------------------

INSERT INTO `directory_identities` (
  `uid`,
  `provider_code`,
  `provider_subject`,
  `provider_username`,
  `email`,
  `mobile_tail4`,
  `profile_json`,
  `last_login_at`,
  `last_synced_at`,
  `status`,
  `created_at`,
  `updated_at`
)
SELECT
  du.`uid`,
  'account',
  du.`uid`,
  du.`username`,
  du.`email`,
  du.`mobile_tail4`,
  JSON_OBJECT('sourceProvider', 'account'),
  du.`last_login_at`,
  @migration_started_at,
  CASE du.`status`
    WHEN 'active' THEN 'active'
    WHEN 'deleted' THEN 'deleted'
    ELSE 'inactive'
  END,
  du.`created_at`,
  @migration_started_at
FROM `directory_users` du
WHERE du.`source_provider` = 'account'
ON DUPLICATE KEY UPDATE
  `uid` = VALUES(`uid`),
  `provider_username` = VALUES(`provider_username`),
  `email` = VALUES(`email`),
  `mobile_tail4` = VALUES(`mobile_tail4`),
  `profile_json` = VALUES(`profile_json`),
  `last_login_at` = VALUES(`last_login_at`),
  `last_synced_at` = VALUES(`last_synced_at`),
  `status` = VALUES(`status`),
  `updated_at` = VALUES(`updated_at`);

INSERT INTO `directory_identities` (
  `uid`,
  `provider_code`,
  `provider_subject`,
  `provider_username`,
  `provider_dn`,
  `email`,
  `last_synced_at`,
  `status`,
  `created_at`,
  `updated_at`
)
SELECT
  usc.`ldap_uid`,
  'ldap',
  usc.`ldap_uid`,
  NULLIF(usc.`ldap_cn`, ''),
  NULLIF(usc.`ldap_dn`, ''),
  NULLIF(usc.`email`, ''),
  COALESCE(usc.`synced_at`, @migration_started_at),
  CASE usc.`status`
    WHEN 1 THEN 'active'
    WHEN 0 THEN 'inactive'
    ELSE 'inactive'
  END,
  COALESCE(usc.`created_at`, @migration_started_at),
  COALESCE(usc.`updated_at`, @migration_started_at)
FROM `hzy_account`.`user_status_cache` usc
INNER JOIN `directory_users` du ON du.`uid` = usc.`ldap_uid`
WHERE usc.`ldap_uid` IS NOT NULL
  AND usc.`ldap_uid` <> ''
ON DUPLICATE KEY UPDATE
  `uid` = VALUES(`uid`),
  `provider_username` = VALUES(`provider_username`),
  `provider_dn` = VALUES(`provider_dn`),
  `email` = VALUES(`email`),
  `last_synced_at` = VALUES(`last_synced_at`),
  `status` = VALUES(`status`),
  `updated_at` = VALUES(`updated_at`);

INSERT INTO `directory_identities` (
  `uid`,
  `provider_code`,
  `provider_subject`,
  `provider_username`,
  `email`,
  `mobile_tail4`,
  `last_synced_at`,
  `status`,
  `created_at`,
  `updated_at`
)
SELECT
  su.`uid`,
  'wecom',
  su.`wecom_id`,
  su.`wecom_id`,
  NULLIF(su.`email`, ''),
  CASE
    WHEN su.`mobile` IS NULL OR su.`mobile` = '' THEN NULL
    ELSE RIGHT(su.`mobile`, 4)
  END,
  @migration_started_at,
  CASE su.`status`
    WHEN 1 THEN 'active'
    WHEN -1 THEN 'deleted'
    ELSE 'inactive'
  END,
  COALESCE(su.`created_at`, @migration_started_at),
  COALESCE(su.`updated_at`, @migration_started_at)
FROM `hzy_account`.`system_users` su
INNER JOIN `directory_users` du ON du.`uid` = su.`uid`
WHERE su.`wecom_id` IS NOT NULL
  AND su.`wecom_id` <> ''
  AND (@account_company_code IS NULL OR su.`company_code` IS NULL OR su.`company_code` = @account_company_code)
ON DUPLICATE KEY UPDATE
  `uid` = VALUES(`uid`),
  `provider_username` = VALUES(`provider_username`),
  `email` = VALUES(`email`),
  `mobile_tail4` = VALUES(`mobile_tail4`),
  `last_synced_at` = VALUES(`last_synced_at`),
  `status` = VALUES(`status`),
  `updated_at` = VALUES(`updated_at`);

INSERT INTO `directory_identities` (
  `uid`,
  `provider_code`,
  `provider_subject`,
  `provider_username`,
  `email`,
  `mobile_tail4`,
  `last_synced_at`,
  `status`,
  `created_at`,
  `updated_at`
)
SELECT
  su.`uid`,
  'dingtalk',
  su.`dingtalk_id`,
  su.`dingtalk_id`,
  NULLIF(su.`email`, ''),
  CASE
    WHEN su.`mobile` IS NULL OR su.`mobile` = '' THEN NULL
    ELSE RIGHT(su.`mobile`, 4)
  END,
  @migration_started_at,
  CASE su.`status`
    WHEN 1 THEN 'active'
    WHEN -1 THEN 'deleted'
    ELSE 'inactive'
  END,
  COALESCE(su.`created_at`, @migration_started_at),
  COALESCE(su.`updated_at`, @migration_started_at)
FROM `hzy_account`.`system_users` su
INNER JOIN `directory_users` du ON du.`uid` = su.`uid`
WHERE su.`dingtalk_id` IS NOT NULL
  AND su.`dingtalk_id` <> ''
  AND (@account_company_code IS NULL OR su.`company_code` IS NULL OR su.`company_code` = @account_company_code)
ON DUPLICATE KEY UPDATE
  `uid` = VALUES(`uid`),
  `provider_username` = VALUES(`provider_username`),
  `email` = VALUES(`email`),
  `mobile_tail4` = VALUES(`mobile_tail4`),
  `last_synced_at` = VALUES(`last_synced_at`),
  `status` = VALUES(`status`),
  `updated_at` = VALUES(`updated_at`);

-- ------------------------------------------------------------
-- 6. Minimal subject export for Platform subject sync
-- ------------------------------------------------------------

INSERT INTO `directory_subject_exports` (
  `subject_type`,
  `subject_code`,
  `external_ref`,
  `parent_subject_type`,
  `parent_subject_code`,
  `source_object_type`,
  `source_object_code`,
  `snapshot_hash`,
  `status`,
  `exported_at`,
  `created_at`,
  `updated_at`
)
SELECT
  CASE WHEN dd.`org_type` = 'committee' THEN 'committee' ELSE 'department' END,
  dd.`dept_code`,
  SHA2(CONCAT('account:', CASE WHEN dd.`org_type` = 'committee' THEN 'committee' ELSE 'department' END, ':', dd.`dept_code`), 256),
  CASE
    WHEN dd.`parent_dept_code` IS NULL THEN NULL
    WHEN parent_dept.`org_type` = 'committee' THEN 'committee'
    ELSE 'department'
  END,
  dd.`parent_dept_code`,
  'directory_departments',
  dd.`dept_code`,
  SHA2(CONCAT_WS('|', CASE WHEN dd.`org_type` = 'committee' THEN 'committee' ELSE 'department' END, dd.`dept_code`, COALESCE(dd.`parent_dept_code`, ''), dd.`status`), 256),
  dd.`status`,
  @migration_started_at,
  @migration_started_at,
  @migration_started_at
FROM `directory_departments` dd
LEFT JOIN `directory_departments` parent_dept
  ON parent_dept.`dept_code` = dd.`parent_dept_code`
WHERE dd.`source_provider` = 'account'
ON DUPLICATE KEY UPDATE
  `external_ref` = VALUES(`external_ref`),
  `parent_subject_type` = VALUES(`parent_subject_type`),
  `parent_subject_code` = VALUES(`parent_subject_code`),
  `snapshot_hash` = VALUES(`snapshot_hash`),
  `status` = VALUES(`status`),
  `exported_at` = VALUES(`exported_at`),
  `updated_at` = VALUES(`updated_at`);

UPDATE `directory_subject_exports` dse
INNER JOIN `directory_departments` dd
  ON dd.`dept_code` = dse.`subject_code`
SET dse.`status` = 'inactive',
    dse.`snapshot_hash` = SHA2(CONCAT_WS('|', 'department', dd.`dept_code`, COALESCE(dd.`parent_dept_code`, ''), 'inactive'), 256),
    dse.`exported_at` = @migration_started_at,
    dse.`updated_at` = @migration_started_at
WHERE dse.`subject_type` = 'department'
  AND dd.`org_type` = 'committee';

INSERT INTO `directory_subject_exports` (
  `subject_type`,
  `subject_code`,
  `external_ref`,
  `parent_subject_type`,
  `parent_subject_code`,
  `source_object_type`,
  `source_object_code`,
  `snapshot_hash`,
  `status`,
  `exported_at`,
  `created_at`,
  `updated_at`
)
SELECT
  'user',
  du.`uid`,
  SHA2(CONCAT('account:user:', du.`uid`), 256),
  CASE WHEN primary_dept.`dept_code` IS NULL THEN NULL ELSE 'department' END,
  primary_dept.`dept_code`,
  'directory_users',
  du.`uid`,
  SHA2(CONCAT_WS('|', 'user', du.`uid`, COALESCE(primary_dept.`dept_code`, ''), du.`status`), 256),
  CASE du.`status`
    WHEN 'pending' THEN 'inactive'
    ELSE du.`status`
  END,
  @migration_started_at,
  @migration_started_at,
  @migration_started_at
FROM `directory_users` du
LEFT JOIN (
  SELECT ranked.`uid`, ranked.`dept_code`
  FROM (
    SELECT
      dud.`uid`,
      dud.`dept_code`,
      ROW_NUMBER() OVER (
        PARTITION BY dud.`uid`
        ORDER BY dud.`is_primary` DESC, dd.`sort_order` ASC, dd.`id` ASC, dud.`id` ASC
      ) AS row_no
    FROM `directory_user_departments` dud
    INNER JOIN `directory_departments` dd ON dd.`dept_code` = dud.`dept_code`
    WHERE dud.`status` = 'active'
      AND dud.`relation_type` = 'member'
      AND dd.`status` = 'active'
      AND dd.`org_type` = 'department'
  ) ranked
  WHERE ranked.row_no = 1
) primary_dept ON primary_dept.`uid` = du.`uid`
WHERE du.`source_provider` = 'account'
ON DUPLICATE KEY UPDATE
  `external_ref` = VALUES(`external_ref`),
  `parent_subject_type` = VALUES(`parent_subject_type`),
  `parent_subject_code` = VALUES(`parent_subject_code`),
  `snapshot_hash` = VALUES(`snapshot_hash`),
  `status` = VALUES(`status`),
  `exported_at` = VALUES(`exported_at`),
  `updated_at` = VALUES(`updated_at`);

INSERT INTO `directory_subject_exports` (
  `subject_type`,
  `subject_code`,
  `external_ref`,
  `parent_subject_type`,
  `parent_subject_code`,
  `source_object_type`,
  `source_object_code`,
  `snapshot_hash`,
  `status`,
  `exported_at`,
  `created_at`,
  `updated_at`
)
SELECT
  'project',
  dp.`project_code`,
  SHA2(CONCAT('account:project:', dp.`project_code`), 256),
  CASE
    WHEN dp.`parent_project_code` IS NOT NULL THEN 'project'
    WHEN dp.`dept_code` IS NOT NULL THEN 'department'
    ELSE NULL
  END,
  COALESCE(dp.`parent_project_code`, dp.`dept_code`),
  'directory_projects',
  dp.`project_code`,
  SHA2(CONCAT_WS('|', 'project', dp.`project_code`, COALESCE(dp.`parent_project_code`, ''), COALESCE(dp.`dept_code`, ''), dp.`status`), 256),
  CASE dp.`status`
    WHEN 'archived' THEN 'inactive'
    ELSE dp.`status`
  END,
  @migration_started_at,
  @migration_started_at,
  @migration_started_at
FROM `directory_projects` dp
WHERE dp.`source_provider` = 'account'
ON DUPLICATE KEY UPDATE
  `external_ref` = VALUES(`external_ref`),
  `parent_subject_type` = VALUES(`parent_subject_type`),
  `parent_subject_code` = VALUES(`parent_subject_code`),
  `snapshot_hash` = VALUES(`snapshot_hash`),
  `status` = VALUES(`status`),
  `exported_at` = VALUES(`exported_at`),
  `updated_at` = VALUES(`updated_at`);

-- ------------------------------------------------------------
-- 7. Summary event and job status
-- ------------------------------------------------------------

INSERT INTO `directory_sync_events` (
  `job_code`,
  `object_type`,
  `object_code`,
  `change_type`,
  `source_provider`,
  `external_ref`,
  `status`,
  `message`,
  `created_at`
) VALUES (
  @job_code,
  'summary',
  '__account_to_console__',
  'upsert',
  'account',
  CONCAT('account:', COALESCE(@account_company_code, '*')),
  'success',
  CONCAT('Account to Console directory migration finished. company_code=', COALESCE(@account_company_code, '*')),
  @migration_started_at
);

UPDATE `directory_sync_jobs`
SET
  `status` = 'success',
  `finished_at` = NOW(),
  `total_count` =
    (SELECT COUNT(*) FROM `directory_departments` WHERE `source_provider` = 'account') +
    (SELECT COUNT(*) FROM `directory_users` WHERE `source_provider` = 'account') +
    (SELECT COUNT(*) FROM `directory_projects` WHERE `source_provider` = 'account') +
    (SELECT COUNT(*) FROM `directory_identities` WHERE `provider_code` IN ('account', 'ldap', 'wecom', 'dingtalk')) +
    (SELECT COUNT(*) FROM `directory_user_departments` WHERE `source_provider` = 'account' AND `status` = 'active') +
    (SELECT COUNT(*) FROM `directory_project_members` WHERE `source_provider` = 'account' AND `status` = 'active'),
  `created_count` = 0,
  `updated_count` = 0,
  `deleted_count` =
    (SELECT COUNT(*) FROM `directory_user_departments` WHERE `source_provider` = 'account' AND `status` = 'inactive') +
    (SELECT COUNT(*) FROM `directory_project_members` WHERE `source_provider` = 'account' AND `status` = 'inactive'),
  `skipped_count` = 0,
  `error_count` = 0,
  `updated_at` = NOW()
WHERE `job_code` = @job_code;

COMMIT;

SELECT
  @job_code AS `job_code`,
  @account_company_code AS `account_company_code`,
  (SELECT COUNT(*) FROM `directory_departments` WHERE `source_provider` = 'account') AS `department_count`,
  (SELECT COUNT(*) FROM `directory_users` WHERE `source_provider` = 'account') AS `user_count`,
  (SELECT COUNT(*) FROM `directory_projects` WHERE `source_provider` = 'account') AS `project_count`,
  (SELECT COUNT(*) FROM `directory_user_departments` WHERE `source_provider` = 'account' AND `status` = 'active') AS `user_department_count`,
  (SELECT COUNT(*) FROM `directory_project_members` WHERE `source_provider` = 'account' AND `status` = 'active') AS `project_member_count`,
  (SELECT COUNT(*) FROM `directory_identities` WHERE `provider_code` IN ('account', 'ldap', 'wecom', 'dingtalk')) AS `identity_count`,
  (SELECT COUNT(*) FROM `directory_subject_exports`) AS `subject_export_count`;
