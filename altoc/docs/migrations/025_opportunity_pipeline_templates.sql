-- Migration 025: Opportunity pipeline templates
-- Run in hzy_altoc or the target Altoc tenant database.

DROP PROCEDURE IF EXISTS hzy_add_opportunity_pipeline_columns;

DELIMITER //

CREATE PROCEDURE hzy_add_opportunity_pipeline_columns()
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE table_schema = DATABASE()
      AND table_name = 'opportunity_stage'
      AND column_name = 'pipeline_code'
  ) THEN
    ALTER TABLE opportunity_stage
      ADD COLUMN pipeline_code VARCHAR(50) NOT NULL DEFAULT 'default' COMMENT '销售管线模板：default/solution/tog_project' AFTER code;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE table_schema = DATABASE()
      AND table_name = 'opportunity_stage'
      AND column_name = 'stage_kind'
  ) THEN
    ALTER TABLE opportunity_stage
      ADD COLUMN stage_kind VARCHAR(30) DEFAULT 'normal' COMMENT '阶段类型：normal/won/lost/paused' AFTER name;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.STATISTICS
    WHERE table_schema = DATABASE()
      AND table_name = 'opportunity_stage'
      AND index_name = 'idx_pipeline_sort'
  ) THEN
    ALTER TABLE opportunity_stage
      ADD INDEX idx_pipeline_sort (pipeline_code, sort_no, id);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.STATISTICS
    WHERE table_schema = DATABASE()
      AND table_name = 'opportunity_stage'
      AND index_name = 'idx_stage_kind'
  ) THEN
    ALTER TABLE opportunity_stage
      ADD INDEX idx_stage_kind (stage_kind);
  END IF;
END//

DELIMITER ;

CALL hzy_add_opportunity_pipeline_columns();

UPDATE opportunity_stage
SET pipeline_code = 'default'
WHERE pipeline_code IS NULL OR pipeline_code = '';

UPDATE opportunity_stage
SET stage_kind = CASE
  WHEN is_won = 1 THEN 'won'
  WHEN is_lost = 1 THEN 'lost'
  WHEN code = 'paused' THEN 'paused'
  ELSE COALESCE(NULLIF(stage_kind, ''), 'normal')
END
WHERE pipeline_code = 'default';

INSERT INTO opportunity_stage
  (code, pipeline_code, stage_kind, name, sort_no, win_rate, is_closed, is_won, is_lost, required_fields_json, exit_criteria_json, is_enabled)
VALUES
  ('solution_discovery', 'solution', 'normal', '线索确认', 1, 10.00, 0, 0, 0, NULL, JSON_OBJECT('description', '确认客户业务痛点、预算可能性和下一步调研安排', 'fields', JSON_ARRAY('next_action', 'next_action_due_at')), 1),
  ('solution_requirements', 'solution', 'normal', '需求调研', 2, 25.00, 0, 0, 0, NULL, JSON_OBJECT('description', '完成关键干系人访谈并形成需求范围', 'fields', JSON_ARRAY('next_action', 'next_action_due_at')), 1),
  ('solution_design', 'solution', 'normal', '方案设计', 3, 45.00, 0, 0, 0, JSON_ARRAY('amount_tax_inclusive', 'expected_sign_date'), JSON_OBJECT('description', '完成方案、范围和初步报价假设', 'fields', JSON_ARRAY('amount_tax_inclusive', 'expected_sign_date', 'next_action', 'next_action_due_at')), 1),
  ('solution_poc', 'solution', 'normal', 'POC/试点', 4, 60.00, 0, 0, 0, JSON_ARRAY('amount_tax_inclusive', 'competitor_info'), JSON_OBJECT('description', '完成验证计划或试点反馈，明确成败标准', 'fields', JSON_ARRAY('competitor_info', 'next_action', 'next_action_due_at')), 1),
  ('solution_negotiation', 'solution', 'normal', '商务谈判', 5, 75.00, 0, 0, 0, JSON_ARRAY('amount_tax_inclusive', 'expected_sign_date'), JSON_OBJECT('description', '商务条件、范围和实施节奏已进入谈判', 'fields', JSON_ARRAY('amount_tax_inclusive', 'expected_sign_date', 'next_action', 'next_action_due_at')), 1),
  ('solution_pending_sign', 'solution', 'normal', '待签约', 6, 90.00, 0, 0, 0, JSON_ARRAY('amount_tax_inclusive', 'expected_sign_date'), JSON_OBJECT('description', '合同条款已确认，等待签署', 'fields', JSON_ARRAY('amount_tax_inclusive', 'expected_sign_date')), 1),
  ('solution_won', 'solution', 'won', '赢单', 7, 100.00, 1, 1, 0, JSON_ARRAY('amount_tax_inclusive', 'expected_sign_date', 'won_reason_code', 'won_reason'), NULL, 1),
  ('solution_lost', 'solution', 'lost', '输单', 8, 0.00, 1, 0, 1, JSON_ARRAY('lost_reason_code', 'lost_reason', 'competitor_info'), NULL, 1),
  ('solution_paused', 'solution', 'paused', '暂停', 9, 0.00, 0, 0, 0, JSON_ARRAY('pause_reason_code', 'pause_reason'), NULL, 1),
  ('tog_intelligence', 'tog_project', 'normal', '项目信息', 1, 5.00, 0, 0, 0, NULL, JSON_OBJECT('description', '识别项目背景、主管单位和采购窗口', 'fields', JSON_ARRAY('next_action', 'next_action_due_at')), 1),
  ('tog_budget_approval', 'tog_project', 'normal', '立项/预算', 2, 15.00, 0, 0, 0, JSON_ARRAY('expected_sign_date'), JSON_OBJECT('description', '跟进立项、预算和采购方式，确认推进路径', 'fields', JSON_ARRAY('expected_sign_date', 'next_action', 'next_action_due_at')), 1),
  ('tog_tender_tracking', 'tog_project', 'normal', '招标跟进', 3, 30.00, 0, 0, 0, JSON_ARRAY('amount_tax_inclusive', 'competitor_info'), JSON_OBJECT('description', '跟进招标文件、评分办法和竞争格局', 'fields', JSON_ARRAY('amount_tax_inclusive', 'competitor_info', 'next_action', 'next_action_due_at')), 1),
  ('tog_bid_preparation', 'tog_project', 'normal', '投标准备', 4, 45.00, 0, 0, 0, JSON_ARRAY('amount_tax_inclusive', 'expected_sign_date', 'competitor_info'), JSON_OBJECT('description', '完成标书、授权、报价和投标排期', 'fields', JSON_ARRAY('amount_tax_inclusive', 'expected_sign_date', 'competitor_info', 'next_action', 'next_action_due_at')), 1),
  ('tog_bid_submitted', 'tog_project', 'normal', '已投标', 5, 60.00, 0, 0, 0, JSON_ARRAY('amount_tax_inclusive', 'expected_sign_date'), JSON_OBJECT('description', '已提交投标文件，等待评审或澄清', 'fields', JSON_ARRAY('amount_tax_inclusive', 'expected_sign_date', 'next_action', 'next_action_due_at')), 1),
  ('tog_pre_award', 'tog_project', 'normal', '中标候选', 6, 80.00, 0, 0, 0, JSON_ARRAY('amount_tax_inclusive', 'expected_sign_date'), JSON_OBJECT('description', '中标候选或拟成交，仍需等待公告、预算或合同流程', 'fields', JSON_ARRAY('amount_tax_inclusive', 'expected_sign_date', 'next_action', 'next_action_due_at')), 1),
  ('tog_pending_contract', 'tog_project', 'normal', '待签合同', 7, 90.00, 0, 0, 0, JSON_ARRAY('amount_tax_inclusive', 'expected_sign_date'), JSON_OBJECT('description', '中标后合同条款和签署流程推进中', 'fields', JSON_ARRAY('amount_tax_inclusive', 'expected_sign_date')), 1),
  ('tog_won', 'tog_project', 'won', '赢单', 8, 100.00, 1, 1, 0, JSON_ARRAY('amount_tax_inclusive', 'expected_sign_date', 'won_reason_code', 'won_reason'), NULL, 1),
  ('tog_lost', 'tog_project', 'lost', '输单', 9, 0.00, 1, 0, 1, JSON_ARRAY('lost_reason_code', 'lost_reason', 'competitor_info'), NULL, 1),
  ('tog_paused', 'tog_project', 'paused', '暂停', 10, 0.00, 0, 0, 0, JSON_ARRAY('pause_reason_code', 'pause_reason'), NULL, 1)
ON DUPLICATE KEY UPDATE
  pipeline_code = VALUES(pipeline_code),
  stage_kind = VALUES(stage_kind),
  name = VALUES(name),
  sort_no = VALUES(sort_no),
  win_rate = VALUES(win_rate),
  is_closed = VALUES(is_closed),
  is_won = VALUES(is_won),
  is_lost = VALUES(is_lost),
  required_fields_json = VALUES(required_fields_json),
  exit_criteria_json = VALUES(exit_criteria_json),
  is_enabled = VALUES(is_enabled);

DROP PROCEDURE IF EXISTS hzy_add_opportunity_pipeline_columns;

