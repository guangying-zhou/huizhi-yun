-- Read-only candidate verification; exact business tuples only.
SELECT a.app_code,a.resource_code,a.action_code,a.status,
 COUNT(r.id) AS routes,MIN(r.status) AS route_status,MIN(s.status) AS schema_status,
 MIN(JSON_UNQUOTE(JSON_EXTRACT(s.nodes,'$[0].type'))) AS first_node_type,
 MIN(JSON_LENGTH(s.nodes)) AS nodes
FROM flow_action_defs a LEFT JOIN flow_routes r ON r.action_def_id=a.id
 LEFT JOIN flow_schemas s ON s.id=r.flow_schema_id
WHERE BINARY a.app_code=BINARY 'altoc' AND a.resource_code IN ('quotation','contract')
 AND BINARY a.action_code=BINARY 'approve'
GROUP BY a.id,a.app_code,a.resource_code,a.action_code,a.status;
-- Historical instances need operator review; never mass-rewrite callback URLs.
SELECT resource_code,action_code,callback_url,status,COUNT(*) AS instances
FROM flow_instances WHERE BINARY app_code=BINARY 'altoc'
GROUP BY resource_code,action_code,callback_url,status;
SELECT l.status,COUNT(*) AS callbacks,MAX(l.attempts) AS maximum_attempts
FROM flow_callback_logs l JOIN flow_instances i ON i.id=l.instance_id
WHERE BINARY i.app_code=BINARY 'altoc' GROUP BY l.status;
