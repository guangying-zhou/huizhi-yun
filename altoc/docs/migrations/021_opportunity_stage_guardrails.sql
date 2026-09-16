-- Migration 021: Opportunity stage guardrails
-- Run in hzy_altoc or the target Altoc tenant database.

DROP PROCEDURE IF EXISTS hzy_modify_stage_log_win_rate_snapshot;

DELIMITER //

CREATE PROCEDURE hzy_modify_stage_log_win_rate_snapshot()
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE table_schema = DATABASE()
      AND table_name = 'opportunity_stage_log'
      AND column_name = 'win_rate_snapshot'
  ) THEN
    ALTER TABLE opportunity_stage_log
      MODIFY COLUMN win_rate_snapshot DECIMAL(5,2) DEFAULT NULL COMMENT '变更后赢率快照';
  END IF;
END//

DELIMITER ;

CALL hzy_modify_stage_log_win_rate_snapshot();

UPDATE opportunity_stage
SET required_fields_json = JSON_ARRAY('amount_tax_inclusive', 'expected_sign_date')
WHERE code = 'won'
  AND (
    required_fields_json IS NULL
    OR JSON_LENGTH(required_fields_json) = 0
    OR JSON_CONTAINS(required_fields_json, JSON_QUOTE('amount_tax_inclusive')) = 0
    OR JSON_CONTAINS(required_fields_json, JSON_QUOTE('expected_sign_date')) = 0
  );

UPDATE opportunity_stage
SET required_fields_json = JSON_ARRAY('lost_reason_code', 'lost_reason', 'competitor_info')
WHERE code = 'lost'
  AND (
    required_fields_json IS NULL
    OR JSON_LENGTH(required_fields_json) = 0
    OR JSON_CONTAINS(required_fields_json, JSON_QUOTE('lost_reason_code')) = 0
    OR JSON_CONTAINS(required_fields_json, JSON_QUOTE('lost_reason')) = 0
    OR JSON_CONTAINS(required_fields_json, JSON_QUOTE('competitor_info')) = 0
  );

UPDATE opportunity_stage
SET required_fields_json = JSON_ARRAY('pause_reason_code', 'pause_reason')
WHERE code = 'paused'
  AND (
    required_fields_json IS NULL
    OR JSON_LENGTH(required_fields_json) = 0
    OR JSON_CONTAINS(required_fields_json, JSON_QUOTE('pause_reason_code')) = 0
    OR JSON_CONTAINS(required_fields_json, JSON_QUOTE('pause_reason')) = 0
  );

DROP PROCEDURE IF EXISTS hzy_modify_stage_log_win_rate_snapshot;
