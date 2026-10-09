-- HZY Platform migration v2.29: enterprise role holder cardinality
--
-- Run once after v2.28 and before seed v2.19.
-- Application writes serialize on tenant_roles before checking overlapping
-- active assignments; direct SQL mutation is not a supported authorization path.

ALTER TABLE `platform_system_roles`
  ADD COLUMN `max_active_assignments` INT UNSIGNED NULL
    COMMENT '同一时点允许的有效持有人上限；NULL 表示不限制'
    AFTER `is_required`,
  ADD COLUMN `subject_type_constraint` VARCHAR(32) NULL
    COMMENT '允许的主体类型：user / department / job；NULL 表示沿用通用规则'
    AFTER `max_active_assignments`,
  ADD CONSTRAINT `chk_platform_system_roles_max_active`
    CHECK (`max_active_assignments` IS NULL OR `max_active_assignments` >= 1),
  ADD CONSTRAINT `chk_platform_system_roles_subject_type`
    CHECK (`subject_type_constraint` IS NULL OR `subject_type_constraint` IN ('user', 'department', 'job'));

ALTER TABLE `tenant_roles`
  ADD COLUMN `max_active_assignments` INT UNSIGNED NULL
    COMMENT '从系统角色物化的有效持有人上限；租户不得扩大'
    AFTER `is_assignable`,
  ADD COLUMN `subject_type_constraint` VARCHAR(32) NULL
    COMMENT '从系统角色物化的主体类型约束；租户不得扩大'
    AFTER `max_active_assignments`,
  ADD CONSTRAINT `chk_tenant_roles_max_active`
    CHECK (`max_active_assignments` IS NULL OR `max_active_assignments` >= 1),
  ADD CONSTRAINT `chk_tenant_roles_subject_type`
    CHECK (`subject_type_constraint` IS NULL OR `subject_type_constraint` IN ('user', 'department', 'job'));

CREATE TABLE IF NOT EXISTS `tenant_role_holder_revisions` (
  `tenant_code` VARCHAR(64) NOT NULL,
  `role_id` BIGINT UNSIGNED NOT NULL,
  `revision` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`tenant_code`, `role_id`),
  CONSTRAINT `fk_tenant_role_holder_revision_role`
    FOREIGN KEY (`role_id`, `tenant_code`) REFERENCES `tenant_roles` (`id`, `tenant_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='企业角色有效持有人变化的单调版本，供 Console 和 Workflow 识别动态职责转移';

UPDATE `platform_system_roles`
SET `max_active_assignments` = 1,
    `subject_type_constraint` = 'user',
    `updated_at` = UTC_TIMESTAMP()
WHERE `role_code` IN ('project_director', 'qa');

UPDATE `tenant_roles`
SET `max_active_assignments` = 1,
    `subject_type_constraint` = 'user',
    `updated_at` = UTC_TIMESTAMP()
WHERE `source` = 'system'
  AND (`source_role_code` IN ('project_director', 'qa') OR `role_code` IN ('project_director', 'qa'));

INSERT INTO `tenant_role_holder_revisions`
  (`tenant_code`, `role_id`, `revision`, `updated_at`)
SELECT
  role.`tenant_code`,
  role.`id`,
  CASE WHEN COUNT(assignment.`id`) > 0 THEN 1 ELSE 0 END,
  UTC_TIMESTAMP()
FROM `tenant_roles` role
LEFT JOIN `tenant_subject_roles` assignment
  ON assignment.`tenant_code` = role.`tenant_code`
 AND assignment.`role_id` = role.`id`
 AND assignment.`status` = 'active'
 AND (assignment.`starts_at` IS NULL OR assignment.`starts_at` <= UTC_TIMESTAMP())
 AND (assignment.`expired_at` IS NULL OR assignment.`expired_at` > UTC_TIMESTAMP())
WHERE role.`role_code` IN ('project_director', 'qa')
GROUP BY role.`tenant_code`, role.`id`
ON DUPLICATE KEY UPDATE
  `revision` = GREATEST(`tenant_role_holder_revisions`.`revision`, VALUES(`revision`)),
  `updated_at` = UTC_TIMESTAMP();

-- Must return no rows before enabling the new business paths.
SELECT
  role.`tenant_code`,
  role.`role_code`,
  COUNT(*) AS `active_holder_count`
FROM `tenant_roles` role
INNER JOIN `tenant_subject_roles` assignment
  ON assignment.`tenant_code` = role.`tenant_code`
 AND assignment.`role_id` = role.`id`
 AND assignment.`status` = 'active'
 AND (assignment.`starts_at` IS NULL OR assignment.`starts_at` <= UTC_TIMESTAMP())
 AND (assignment.`expired_at` IS NULL OR assignment.`expired_at` > UTC_TIMESTAMP())
WHERE role.`role_code` IN ('project_director', 'qa')
GROUP BY role.`tenant_code`, role.`role_code`
HAVING COUNT(*) > 1;
