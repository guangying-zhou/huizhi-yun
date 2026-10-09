-- CANDIDATE ONLY. Reviewed owning Workflow DB, never run by the application.
-- @apf_people_reviewer_uid / @apf_people_installer_uid: active Console users.
-- The one existing Host tuple is people/assignments/change. Onboarding
-- provisioning and Directory offboarding are NOT separate approval tuples.
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
DELIMITER //
CREATE PROCEDURE seed_apf_people_assignment_candidate()
BEGIN
 DECLARE action_id BIGINT UNSIGNED;
 DECLARE schema_id BIGINT UNSIGNED;
 DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;
 IF @apf_people_reviewer_uid IS NULL OR CHAR_LENGTH(@apf_people_reviewer_uid) NOT BETWEEN 1 AND 50
  OR CHAR_LENGTH(@apf_people_reviewer_uid)<>CHAR_LENGTH(TRIM(@apf_people_reviewer_uid))
  OR @apf_people_reviewer_uid LIKE '@%' OR @apf_people_reviewer_uid REGEXP '[[:cntrl:]]'
  OR @apf_people_installer_uid IS NULL OR CHAR_LENGTH(@apf_people_installer_uid) NOT BETWEEN 1 AND 50
  OR CHAR_LENGTH(@apf_people_installer_uid)<>CHAR_LENGTH(TRIM(@apf_people_installer_uid))
  OR @apf_people_installer_uid LIKE '@%' OR @apf_people_installer_uid REGEXP '[[:cntrl:]]' THEN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Reviewed active Directory reviewer and installer are required';
 END IF;
 START TRANSACTION;
 IF EXISTS(SELECT 1 FROM flow_action_defs WHERE app_code='people' AND resource_code='assignments' AND action_code='change' AND status<>1) THEN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Inactive People definition must not be revived';
 END IF;
 INSERT INTO flow_action_defs(app_code,resource_code,action_code,name,description,created_by)
 SELECT 'people','assignments','change','任职变更审批','APF frozen assignment change',@apf_people_installer_uid
 WHERE NOT EXISTS(SELECT 1 FROM flow_action_defs WHERE app_code='people' AND resource_code='assignments' AND action_code='change');
 SELECT id INTO action_id FROM flow_action_defs WHERE app_code='people' AND resource_code='assignments' AND action_code='change' AND status=1;
 IF EXISTS(SELECT 1 FROM flow_routes WHERE action_def_id=action_id) OR EXISTS(SELECT 1 FROM flow_schemas WHERE code='apf-people-assignment-change') THEN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Existing People routing requires explicit review; no overwrite';
 END IF;
 INSERT INTO flow_schemas(code,name,nodes,config,created_by) VALUES(
 'apf-people-assignment-change','任职变更审批',
 JSON_ARRAY(JSON_OBJECT('name','人事审批','type','approve','approve_mode','any','assignees',
 JSON_ARRAY(JSON_OBJECT('type','user','uid',@apf_people_reviewer_uid)))),
 JSON_OBJECT('allow_resubmit',true),@apf_people_installer_uid);
 SET schema_id=LAST_INSERT_ID();
 INSERT INTO flow_routes(action_def_id,flow_schema_id,name,is_default,created_by)
 VALUES(action_id,schema_id,'任职变更默认人工审批',1,@apf_people_installer_uid);
 COMMIT;
END//
DELIMITER ;
CALL seed_apf_people_assignment_candidate();
DROP PROCEDURE seed_apf_people_assignment_candidate;
