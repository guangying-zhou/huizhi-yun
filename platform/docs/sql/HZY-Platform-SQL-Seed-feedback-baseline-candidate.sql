-- Candidate only, after Console manifest publication. Apply separately with
-- Platform approval then re-sign test. Manifest actions are the sole source.
-- Preserve disabled baseline rows; never revive them by seed.
INSERT INTO platform_baseline_permissions
 (app_code,resource_code,action,scope_type,scope_value,description,sort_order,status,source_manifest_action_id)
SELECT m.app_code,m.resource_code,m.action,'subject','self','登录用户提交和查看本人反馈',340,'active',m.id
FROM platform_app_manifest_resource_actions m
WHERE m.app_code='console' AND m.resource_code='feedback'
 AND m.action IN ('view','submit') AND m.status='active'
 AND NOT EXISTS(SELECT 1 FROM platform_baseline_permissions b
  WHERE b.app_code=m.app_code AND b.resource_code=m.resource_code AND b.action=m.action
   AND b.scope_type='subject' AND b.scope_value='self');
-- Verify exactly two active manifest-bound subject:self entries before signing.
SELECT b.action,b.scope_type,b.scope_value,b.status,b.source_manifest_action_id
FROM platform_baseline_permissions b
WHERE b.app_code='console' AND b.resource_code='feedback';
