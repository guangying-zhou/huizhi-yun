-- CANDIDATE ONLY. DO NOT run as part of a build, migration or deployment.
-- On the reviewed Workflow database, supply @apf12_reviewer_uid and
-- @apf12_installer_uid from current Console directory facts. No credentials.
-- Existing active route/definition conflicts stop; never replace live flows.
-- No customer/approve definition, no grant, no auto-approval flow is installed.
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
DELIMITER //
CREATE PROCEDURE seed_apf12_approval_candidate()
BEGIN
 DECLARE resource_value VARCHAR(30);
 DECLARE action_id BIGINT UNSIGNED;
 DECLARE schema_id BIGINT UNSIGNED;
 DECLARE n INT DEFAULT 0;
 DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;
 IF @apf12_reviewer_uid IS NULL OR LENGTH(TRIM(@apf12_reviewer_uid)) NOT BETWEEN 1 AND 50
  OR @apf12_installer_uid IS NULL OR LENGTH(TRIM(@apf12_installer_uid)) NOT BETWEEN 1 AND 50 THEN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Reviewed directory reviewer and installer are required';
 END IF;
 START TRANSACTION;
 WHILE n<2 DO
  SET resource_value=IF(n=0,'quotation','contract');
  IF EXISTS(SELECT 1 FROM flow_action_defs WHERE app_code='altoc' AND resource_code=resource_value AND action_code='approve' AND status<>1) THEN
   SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Inactive definition must not be revived';
  END IF;
  INSERT INTO flow_action_defs(app_code,resource_code,action_code,name,description,created_by)
   SELECT 'altoc',resource_value,'approve',IF(n=0,'报价审批','合同审批'),'APF12 frozen approval',@apf12_installer_uid
   WHERE NOT EXISTS(SELECT 1 FROM flow_action_defs WHERE app_code='altoc' AND resource_code=resource_value AND action_code='approve');
  SELECT id INTO action_id FROM flow_action_defs WHERE app_code='altoc' AND resource_code=resource_value AND action_code='approve' AND status=1;
  IF EXISTS(SELECT 1 FROM flow_routes WHERE action_def_id=action_id) THEN
   SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Existing routes require explicit review; do not overwrite';
  END IF;
  IF EXISTS(SELECT 1 FROM flow_schemas WHERE code=CONCAT('apf12-',resource_value,'-approve')) THEN
   SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Existing flow schema requires explicit review';
  END IF;
  INSERT INTO flow_schemas(code,name,nodes,config,created_by) VALUES(
   CONCAT('apf12-',resource_value,'-approve'),IF(n=0,'报价审批','合同审批'),
   JSON_ARRAY(JSON_OBJECT('name','审批','type','approve','approve_mode','any','assignees',
    JSON_ARRAY(JSON_OBJECT('type','user','uid',@apf12_reviewer_uid)))),
   JSON_OBJECT('allow_resubmit',false),@apf12_installer_uid);
  SET schema_id=LAST_INSERT_ID();
  INSERT INTO flow_routes(action_def_id,flow_schema_id,name,is_default,created_by)
   VALUES(action_id,schema_id,'APF12 默认人工审批',1,@apf12_installer_uid);
  SET n=n+1;
 END WHILE;
 COMMIT;
END//
DELIMITER ;
CALL seed_apf12_approval_candidate();
DROP PROCEDURE seed_apf12_approval_candidate;
