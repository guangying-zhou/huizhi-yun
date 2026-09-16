-- Aims v5.17: 日常事务容器不经过立项审批，创建后直接启用。
--
-- 修复 v5.14 上线后、应用修正前可能已创建为 draft / approval_pending 的
-- routine 容器。生命周期事件先追加、项目状态后更新；整段事务可安全重放。

START TRANSACTION;

INSERT INTO `project_lifecycle_events` (
  `project_id`, `from_status`, `to_status`, `effective_at`, `actor_uid`, `source`
)
SELECT
  p.`id`, p.`lifecycle_status`, 'active', UTC_TIMESTAMP(6), 'system',
  'aims.migration.v5.17'
FROM `aims_projects` p
WHERE p.`category` = 'routine'
  AND p.`lifecycle_status` IN ('draft', 'approval_pending')
  AND NOT EXISTS (
    SELECT 1
    FROM `project_lifecycle_events` event
    WHERE event.`project_id` = p.`id`
      AND event.`source` = 'aims.migration.v5.17'
      AND event.`to_status` = 'active'
  );

UPDATE `aims_projects`
SET `lifecycle_status` = 'active',
    `approval_status` = 'not_required',
    `workflow_instance_id` = NULL
WHERE `category` = 'routine'
  AND `lifecycle_status` IN ('draft', 'approval_pending');

COMMIT;

-- 验证：必须返回空结果。
SELECT `id`, `project_code`, `lifecycle_status`, `approval_status`, `workflow_instance_id`
FROM `aims_projects`
WHERE `category` = 'routine'
  AND (`lifecycle_status` IN ('draft', 'approval_pending')
       OR `approval_status` <> 'not_required');
