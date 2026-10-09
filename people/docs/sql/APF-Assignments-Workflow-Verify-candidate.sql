-- READ ONLY. Expect one enabled exact action and one reviewed enabled default
-- route/schema. Check assignee UID eligibility in current Console Directory.
SELECT a.id,a.app_code,a.resource_code,a.action_code,a.status,
 r.id route_id,r.status route_status,r.is_default,r.conditions,r.level,r.priority,
 s.code schema_code,s.status schema_status,s.nodes,s.config
FROM flow_action_defs a LEFT JOIN flow_routes r ON r.action_def_id=a.id
LEFT JOIN flow_schemas s ON s.id=r.flow_schema_id
WHERE BINARY a.app_code=BINARY 'people' AND BINARY a.resource_code=BINARY 'assignments'
 AND BINARY a.action_code=BINARY 'change';
-- These tuples have no Host submit/bind/callback chain; report them rather
-- than installing new default routes or sending their callbacks to assignments.
SELECT app_code,resource_code,action_code,status FROM flow_action_defs
WHERE BINARY app_code=BINARY 'people' AND resource_code IN ('onboarding','offboarding','onboarding_cases','offboarding_cases');
