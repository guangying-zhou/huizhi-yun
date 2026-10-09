-- CANDIDATE ONLY. Not executed by application/build/install tools.
-- Run only after reviewed deployment, in the owning Workflow database.
-- Operator must set @apf_payment_reviewer_uid and @apf_seed_actor_uid to active
-- real users. No default approver / @all / automatic approval is supplied.
-- Existing finance/expenses/payment definition is reused; no capability/grant.
START TRANSACTION;
INSERT INTO flow_action_defs(app_code,resource_code,action_code,name,created_by)
SELECT 'finance','expenses','payment','付款申请审批',@apf_seed_actor_uid
WHERE COALESCE(TRIM(@apf_seed_actor_uid),'') <> ''
  AND NOT EXISTS(SELECT 1 FROM flow_action_defs WHERE app_code='finance' AND resource_code='expenses' AND action_code='payment');
INSERT INTO flow_schemas(code,name,nodes,config,created_by)
SELECT 'apf13b-payment','付款申请审批',
 JSON_ARRAY(JSON_OBJECT('name','财务审核','type','approve','approve_mode','any','assignees',JSON_ARRAY(JSON_OBJECT('type','user','uid',@apf_payment_reviewer_uid)))),
 JSON_OBJECT('allow_resubmit',true),@apf_seed_actor_uid
WHERE COALESCE(TRIM(@apf_payment_reviewer_uid),'') <> ''
 AND @apf_payment_reviewer_uid NOT LIKE '@%'
 AND LENGTH(@apf_payment_reviewer_uid)<=64
 AND @apf_payment_reviewer_uid=TRIM(@apf_payment_reviewer_uid)
 AND @apf_payment_reviewer_uid NOT REGEXP '[[:cntrl:]]'
 AND COALESCE(TRIM(@apf_seed_actor_uid),'') <> ''
 AND NOT EXISTS(SELECT 1 FROM flow_schemas WHERE code='apf13b-payment');
-- Never replace an existing human routing policy. An installation with an
-- existing default must review/update that route explicitly before verification.
INSERT INTO flow_routes(action_def_id,flow_schema_id,name,is_default,created_by)
SELECT a.id,s.id,'付款申请默认人工审核',1,@apf_seed_actor_uid
FROM flow_action_defs a JOIN flow_schemas s ON s.code='apf13b-payment'
WHERE a.app_code='finance' AND a.resource_code='expenses' AND a.action_code='payment'
 AND a.status=1 AND s.status=1
 AND NOT EXISTS(SELECT 1 FROM flow_routes r WHERE r.action_def_id=a.id AND r.is_default=1 AND r.status=1);
COMMIT;

