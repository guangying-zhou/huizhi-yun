-- READ ONLY. Reviewed owning Workflow database. Not a seed or grant script.
-- Missing action, inactive schema, duplicate/conditional defaults and @all/empty
-- assignees must STOP enablement. Each UID still needs current Console eligibility
-- and SoD checks; this SQL cannot inspect a different owning database.
WITH required AS (
 SELECT 'people' app,'assignments' resource,'change' action
 UNION ALL SELECT 'altoc','quotation','approve'
 UNION ALL SELECT 'altoc','contract','approve'
 UNION ALL SELECT 'finance','invoices','request'
 UNION ALL SELECT 'finance','expenses','claim'
 UNION ALL SELECT 'finance','expenses','project_expense'
 UNION ALL SELECT 'finance','expenses','payment'
)
SELECT q.app,q.resource,q.action,a.id action_id,a.status action_status,
 r.id route_id,r.status route_status,r.is_default,r.conditions,r.level,r.priority,
 s.id schema_id,s.code schema_code,s.status schema_status,s.nodes,s.config
FROM required q LEFT JOIN flow_action_defs a
 ON BINARY a.app_code=BINARY q.app AND BINARY a.resource_code=BINARY q.resource AND BINARY a.action_code=BINARY q.action
LEFT JOIN flow_routes r ON r.action_def_id=a.id
LEFT JOIN flow_schemas s ON s.id=r.flow_schema_id
ORDER BY q.app,q.resource,q.action,r.priority DESC,r.id;
