-- Only before any binding data exists; otherwise retain the additive column.
DELIMITER $$
CREATE PROCEDURE rollback_milestone_billing_schedule()
BEGIN
 IF EXISTS(SELECT 1 FROM aims_milestones WHERE billing_schedule_code IS NOT NULL) THEN
   SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='billing schedule bindings exist; rollback refused';
 END IF;
 ALTER TABLE aims_milestones DROP INDEX idx_milestone_billing_schedule, DROP COLUMN billing_schedule_code;
 CREATE OR REPLACE ALGORITHM=MERGE SQL SECURITY INVOKER VIEW milestones AS SELECT * FROM aims_milestones;
END$$
DELIMITER ;
CALL rollback_milestone_billing_schedule();
DROP PROCEDURE rollback_milestone_billing_schedule;
