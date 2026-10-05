-- Fail closed when the Aims milestone-completion workflow migration was skipped
-- or only partially applied. This file is intentionally ordered immediately
-- after 010_aims_milestone_completion.sql by the deployment migration loop.

DROP TEMPORARY TABLE IF EXISTS tmp_aims_milestone_completion_guard;

CREATE TEMPORARY TABLE tmp_aims_milestone_completion_guard (
  check_name VARCHAR(100) NOT NULL PRIMARY KEY,
  passed TINYINT(1) NOT NULL CHECK (passed = 1)
);

INSERT INTO tmp_aims_milestone_completion_guard (check_name, passed)
SELECT
  'active_action_definition',
  IF(COUNT(*) = 1, 1, 0)
FROM flow_action_defs
WHERE app_code = 'aims'
  AND resource_code = 'milestones'
  AND action_code = 'milestone_completion'
  AND status = 1;

INSERT INTO tmp_aims_milestone_completion_guard (check_name, passed)
SELECT
  'active_flow_schema',
  IF(COUNT(*) = 1, 1, 0)
FROM flow_schemas
WHERE code = 'aims_milestone_completion'
  AND status = 1;

INSERT INTO tmp_aims_milestone_completion_guard (check_name, passed)
SELECT
  'active_default_route',
  IF(COUNT(*) = 1, 1, 0)
FROM flow_routes route
JOIN flow_action_defs action_def ON action_def.id = route.action_def_id
JOIN flow_schemas flow_schema ON flow_schema.id = route.flow_schema_id
WHERE action_def.app_code = 'aims'
  AND action_def.resource_code = 'milestones'
  AND action_def.action_code = 'milestone_completion'
  AND action_def.status = 1
  AND flow_schema.code = 'aims_milestone_completion'
  AND flow_schema.status = 1
  AND route.is_default = 1
  AND route.status = 1;

SELECT check_name, passed
FROM tmp_aims_milestone_completion_guard
ORDER BY check_name;

DROP TEMPORARY TABLE tmp_aims_milestone_completion_guard;
