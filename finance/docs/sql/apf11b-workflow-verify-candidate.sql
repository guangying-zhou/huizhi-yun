-- READ-ONLY CANDIDATE, not executed. Exactly one enabled tuple and one reviewed
-- default human route are expected; inspect reviewer UID against directory and
-- Workflow task permissions before deployment. Runtime forbids applicant self-review.
SELECT a.id,a.app_code,a.resource_code,a.action_code,a.status,
 r.id AS route_id,r.status AS route_status,r.is_default,s.code,s.nodes,s.config
FROM flow_action_defs a LEFT JOIN flow_routes r ON r.action_def_id=a.id AND r.is_default=1 AND r.status=1
LEFT JOIN flow_schemas s ON s.id=r.flow_schema_id AND s.status=1
WHERE a.app_code='finance' AND a.resource_code='invoices' AND a.action_code='request';
-- Existing grants to verify with the reviewed Console service-grant verifier:
-- enterprise.runtime -> workflow: workflow:proxy
-- workflow.runtime -> enterprise: enterprise:workflow-callback:execute
-- enterprise.runtime -> Runtime and Console:
--   finance:enterprise-host:execute, finance:scheduler:execute
-- No new grant/capability is added by APF-11b. Do not run onboarding/lifecycle seeds.
