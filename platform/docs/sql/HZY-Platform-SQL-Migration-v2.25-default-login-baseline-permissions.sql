-- HZY Platform SQL Migration v2.25: default login baseline permissions.
-- Makes employee default-login permissions governable in Platform and allows
-- selected users to be excluded from those baseline grants.

CREATE TABLE IF NOT EXISTS `platform_baseline_permissions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `app_code` VARCHAR(64) NOT NULL,
  `resource_code` VARCHAR(128) NOT NULL,
  `action` VARCHAR(64) NOT NULL,
  `scope_type` VARCHAR(64) NOT NULL,
  `scope_value` VARCHAR(128) NOT NULL,
  `source_manifest_action_id` BIGINT UNSIGNED NULL,
  `description` VARCHAR(500) NULL,
  `sort_order` INT NOT NULL DEFAULT 0,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_platform_baseline_permissions` (`app_code`, `resource_code`, `action`, `scope_type`, `scope_value`),
  KEY `idx_platform_baseline_permissions_status` (`status`, `app_code`, `sort_order`),
  KEY `idx_platform_baseline_permissions_manifest_action` (`source_manifest_action_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='默认登录用户 baseline 权限；在角色权限界面作为强制已选项展示';

CREATE TABLE IF NOT EXISTS `platform_baseline_excluded_subjects` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `subject_code` VARCHAR(128) NOT NULL,
  `display_name` VARCHAR(128) NULL,
  `reason` VARCHAR(500) NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_platform_baseline_excluded_subjects` (`subject_code`),
  KEY `idx_platform_baseline_excluded_subjects_status` (`status`, `subject_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='从默认登录 baseline 权限中排除的用户 subject_code / uid';

INSERT INTO `platform_baseline_permissions`
  (`app_code`, `resource_code`, `action`, `scope_type`, `scope_value`, `description`, `sort_order`, `status`)
VALUES
  ('workflow', 'workflow_workspace', 'view', 'subject', 'self', '默认登录用户可访问自己的流程工作台', 10, 'active'),
  ('workflow', 'workflow_tasks', 'view', 'relation', 'assigned', '默认登录用户可查看分配给自己的流程任务', 20, 'active'),
  ('workflow', 'workflow_tasks', 'edit', 'relation', 'assigned', '默认登录用户可处理分配给自己的流程任务', 30, 'active'),
  ('workflow', 'workflow_instances', 'view', 'subject', 'self', '默认登录用户可查看自己发起的流程实例', 40, 'active'),
  ('codocs', 'documents', 'view', 'relation', 'owned_or_shared', '默认登录用户可查看自有或共享文档', 100, 'active'),
  ('codocs', 'documents', 'create', 'subject', 'self', '默认登录用户可创建个人文档', 110, 'active'),
  ('codocs', 'documents', 'edit', 'relation', 'owned_or_shared', '默认登录用户可编辑自有或共享文档', 120, 'active'),
  ('codocs', 'documents', 'delete', 'relation', 'owned_or_shared', '默认登录用户可删除自有或共享文档', 130, 'active'),
  ('codocs', 'departments', 'view', 'relation', 'member_department', '默认登录用户可查看所在部门文档', 140, 'active'),
  ('codocs', 'departments', 'create', 'relation', 'member_department', '默认登录用户可在所在部门创建文档', 150, 'active'),
  ('codocs', 'departments', 'edit', 'relation', 'member_department', '默认登录用户可编辑所在部门文档', 160, 'active'),
  ('codocs', 'company', 'view', 'tenant', 'published', '默认登录用户可查看已发布企业文档', 170, 'active'),
  ('codocs', 'info', 'view', 'tenant', 'published', '默认登录用户可查看已发布资讯', 180, 'active'),
  ('codocs', 'reviews', 'view', 'relation', 'participant', '默认登录用户可查看参与的文档评审', 190, 'active'),
  ('codocs', 'reviews', 'submit', 'subject', 'self', '默认登录用户可提交自己的文档评审', 200, 'active'),
  ('aims', 'aims_overview', 'view', 'relation', 'participant', '默认登录用户可查看参与项目概览', 300, 'active'),
  ('aims', 'projects', 'view', 'relation', 'participant', '默认登录用户可查看参与项目', 310, 'active'),
  ('aims', 'work_items', 'view', 'relation', 'participant', '默认登录用户可查看参与工作项', 320, 'active'),
  ('aims', 'notifications', 'view', 'subject', 'self', '默认登录用户可查看自己的项目通知', 330, 'active')
ON DUPLICATE KEY UPDATE
  `description` = VALUES(`description`),
  `sort_order` = VALUES(`sort_order`),
  `status` = VALUES(`status`),
  `updated_at` = UTC_TIMESTAMP();

UPDATE `platform_baseline_permissions` bp
INNER JOIN `platform_app_manifest_resource_actions` mra
  ON mra.app_code = bp.app_code
 AND mra.resource_code = bp.resource_code
 AND mra.action = bp.action
 AND mra.status = 'active'
SET bp.source_manifest_action_id = mra.id
WHERE bp.source_manifest_action_id IS NULL;
