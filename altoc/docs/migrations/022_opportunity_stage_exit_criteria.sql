-- Migration 022: Opportunity stage exit criteria
-- Run in hzy_altoc or the target Altoc tenant database.

UPDATE opportunity_stage
SET exit_criteria_json = JSON_OBJECT(
  'description', '确认客户有初步需求意向并安排下一步',
  'fields', JSON_ARRAY('next_action', 'next_action_due_at')
)
WHERE code = 'initial_contact'
  AND (
    exit_criteria_json IS NULL
    OR JSON_LENGTH(exit_criteria_json) = 0
    OR (
      JSON_TYPE(exit_criteria_json) = 'OBJECT'
      AND JSON_EXTRACT(exit_criteria_json, '$.fields') IS NULL
      AND JSON_EXTRACT(exit_criteria_json, '$.required_fields') IS NULL
      AND JSON_EXTRACT(exit_criteria_json, '$.requiredFields') IS NULL
    )
  );

UPDATE opportunity_stage
SET exit_criteria_json = JSON_OBJECT(
  'description', '客户需求已明确，可以输出方案',
  'fields', JSON_ARRAY('amount_tax_inclusive', 'next_action', 'next_action_due_at')
)
WHERE code = 'requirement_confirmed'
  AND (
    exit_criteria_json IS NULL
    OR JSON_LENGTH(exit_criteria_json) = 0
    OR (
      JSON_TYPE(exit_criteria_json) = 'OBJECT'
      AND JSON_EXTRACT(exit_criteria_json, '$.fields') IS NULL
      AND JSON_EXTRACT(exit_criteria_json, '$.required_fields') IS NULL
      AND JSON_EXTRACT(exit_criteria_json, '$.requiredFields') IS NULL
    )
  );

UPDATE opportunity_stage
SET exit_criteria_json = JSON_OBJECT(
  'description', '方案/报价已提交客户并约定反馈',
  'fields', JSON_ARRAY('amount_tax_inclusive', 'competitor_info', 'next_action', 'next_action_due_at')
)
WHERE code = 'proposal_quotation'
  AND (
    exit_criteria_json IS NULL
    OR JSON_LENGTH(exit_criteria_json) = 0
    OR (
      JSON_TYPE(exit_criteria_json) = 'OBJECT'
      AND JSON_EXTRACT(exit_criteria_json, '$.fields') IS NULL
      AND JSON_EXTRACT(exit_criteria_json, '$.required_fields') IS NULL
      AND JSON_EXTRACT(exit_criteria_json, '$.requiredFields') IS NULL
    )
  );

UPDATE opportunity_stage
SET exit_criteria_json = JSON_OBJECT(
  'description', '完成商务条件谈判并明确签约计划',
  'fields', JSON_ARRAY('amount_tax_inclusive', 'expected_sign_date', 'next_action', 'next_action_due_at')
)
WHERE code = 'negotiation'
  AND (
    exit_criteria_json IS NULL
    OR JSON_LENGTH(exit_criteria_json) = 0
    OR (
      JSON_TYPE(exit_criteria_json) = 'OBJECT'
      AND JSON_EXTRACT(exit_criteria_json, '$.fields') IS NULL
      AND JSON_EXTRACT(exit_criteria_json, '$.required_fields') IS NULL
      AND JSON_EXTRACT(exit_criteria_json, '$.requiredFields') IS NULL
    )
  );

UPDATE opportunity_stage
SET exit_criteria_json = JSON_OBJECT(
  'description', '合同条款已确认，等待签署',
  'fields', JSON_ARRAY('amount_tax_inclusive', 'expected_sign_date')
)
WHERE code = 'pending_sign'
  AND (
    exit_criteria_json IS NULL
    OR JSON_LENGTH(exit_criteria_json) = 0
    OR (
      JSON_TYPE(exit_criteria_json) = 'OBJECT'
      AND JSON_EXTRACT(exit_criteria_json, '$.fields') IS NULL
      AND JSON_EXTRACT(exit_criteria_json, '$.required_fields') IS NULL
      AND JSON_EXTRACT(exit_criteria_json, '$.requiredFields') IS NULL
    )
  );
