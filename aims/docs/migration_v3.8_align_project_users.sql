-- ============================================================
-- 迁移脚本：对齐旧业务项目负责人/成员到 Console Directory UID
--
-- 背景：
--   早期从 wizbizdb.wb_project / wb_project_member 迁移到 AIMS 的项目
--   保留了旧业务库 employee_id，导致负责人显示为数字，成员也未同步。
--
-- 规则：
--   1. AIMS 项目成员角色收敛为 manager / member / viewer。
--   2. WBPMIG{project_id} 对应 wizbizdb.wb_project.project_id。
--   3. 旧员工通过姓名/手机号唯一匹配 Console 活跃用户。
--   4. wb_project.employee_id 与 wb_project_member.pm_type='0' 迁移为 manager。
--   5. wb_project_member.pm_type!='0' 迁移为 member。
--   6. 无法匹配 Console 活跃用户的离职/缺失员工不写入成员表。
-- ============================================================

USE `hzy_aims`;

CREATE TABLE IF NOT EXISTS `migration_backup_202605_project_user_align_projects` AS
SELECT *
FROM `aims_projects`;

CREATE TABLE IF NOT EXISTS `migration_backup_202605_project_user_align_members` AS
SELECT *
FROM `aims_project_members`;

ALTER TABLE `aims_project_members`
  MODIFY COLUMN `role` ENUM('manager','developer','tester','member','viewer')
    NOT NULL DEFAULT 'member'
    COMMENT '项目角色迁移中: developer/tester 将收敛为 member';

UPDATE `aims_project_members`
SET `role` = 'member'
WHERE `role` IN ('developer', 'tester');

ALTER TABLE `aims_project_members`
  MODIFY COLUMN `role` ENUM('manager','member','viewer')
    NOT NULL DEFAULT 'member'
    COMMENT '项目角色: manager=项目经理/负责人, member=项目成员, viewer=观察者';

CREATE TEMPORARY TABLE `tmp_aims_employee_console_user_map` AS
SELECT
  e.`employee_id`,
  MIN(du.`uid`) AS `uid`,
  COUNT(DISTINCT du.`uid`) AS `match_count`
FROM `wizbizdb`.`wb_employee` e
LEFT JOIN `hzy_console`.`directory_users` du
  ON du.`status` = 'active'
 AND (
      du.`real_name` COLLATE utf8mb4_0900_ai_ci = e.`name` COLLATE utf8mb4_0900_ai_ci
   OR du.`display_name` COLLATE utf8mb4_0900_ai_ci = e.`name` COLLATE utf8mb4_0900_ai_ci
   OR (
        du.`mobile` IS NOT NULL
    AND du.`mobile` <> ''
    AND du.`mobile` COLLATE utf8mb4_0900_ai_ci = e.`mobile_number` COLLATE utf8mb4_0900_ai_ci
      )
 )
GROUP BY e.`employee_id`;

UPDATE `aims_projects` p
JOIN `wizbizdb`.`wb_employee` e
  ON e.`employee_id` = CAST(p.`leader_uid` AS UNSIGNED)
JOIN `tmp_aims_employee_console_user_map` um
  ON um.`employee_id` = e.`employee_id`
 AND um.`match_count` = 1
SET p.`leader_uid` = um.`uid`
WHERE p.`project_code` REGEXP '^WBPMIG[0-9]+$'
  AND p.`leader_uid` REGEXP '^[0-9]+$';

INSERT INTO `aims_project_members` (`project_id`, `uid`, `role`, `status`, `joined_at`)
SELECT
  p.`id`,
  um.`uid`,
  CASE WHEN m.`pm_type` = '0' THEN 'manager' ELSE 'member' END AS `role`,
  'active',
  COALESCE(m.`join_time`, NOW())
FROM `wizbizdb`.`wb_project_member` m
JOIN `aims_projects` p
  ON p.`project_code` = CONCAT('WBPMIG', m.`project_id`)
JOIN `tmp_aims_employee_console_user_map` um
  ON um.`employee_id` = m.`employee_id`
 AND um.`match_count` = 1
WHERE m.`pm_status` = '0'
ON DUPLICATE KEY UPDATE
  `role` = CASE
    WHEN VALUES(`role`) = 'manager' OR `aims_project_members`.`role` = 'manager'
      THEN 'manager'
    ELSE VALUES(`role`)
  END,
  `status` = 'active';

INSERT INTO `aims_project_members` (`project_id`, `uid`, `role`, `status`, `joined_at`)
SELECT
  p.`id`,
  um.`uid`,
  'manager',
  'active',
  NOW()
FROM `aims_projects` p
JOIN `wizbizdb`.`wb_project` lp
  ON p.`project_code` = CONCAT('WBPMIG', lp.`project_id`)
JOIN `tmp_aims_employee_console_user_map` um
  ON um.`employee_id` = lp.`employee_id`
 AND um.`match_count` = 1
WHERE p.`project_code` REGEXP '^WBPMIG[0-9]+$'
ON DUPLICATE KEY UPDATE
  `role` = 'manager',
  `status` = 'active';
