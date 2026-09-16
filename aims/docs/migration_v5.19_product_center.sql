-- Aims v5.19: additive product workspace and prioritization storage.
-- Run preflight first. Existing product/version/work-item identities are retained.
-- Product codes are case-sensitive. Cross-application references have no DB FK.
-- This migration does not enable product-center entry points or seed permissions.

CREATE TABLE IF NOT EXISTS product_workspaces (
  product_code VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  biz_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  positioning TEXT NULL,
  target_users TEXT NULL,
  value_statement TEXT NULL,
  status ENUM('active','archived') NOT NULL DEFAULT 'active',
  revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_by VARCHAR(64) NOT NULL,
  updated_by VARCHAR(64) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (product_code), UNIQUE KEY uk_pc_workspace_biz (biz_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS product_members (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  product_code VARCHAR(64) NOT NULL,
  uid VARCHAR(64) NOT NULL,
  relation_type ENUM('manager','contributor','viewer') NOT NULL,
  status ENUM('active','inactive') NOT NULL DEFAULT 'active',
  valid_from DATETIME(3) NOT NULL,
  valid_until DATETIME(3) NULL,
  revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_by VARCHAR(64) NOT NULL,
  updated_by VARCHAR(64) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id), UNIQUE KEY uk_pc_member (product_code,uid,relation_type),
  KEY idx_pc_member_subject (uid,status,product_code),
  CONSTRAINT fk_pc_member_product FOREIGN KEY (product_code) REFERENCES product_workspaces(product_code),
  CONSTRAINT ck_pc_member_dates CHECK (valid_until IS NULL OR valid_until > valid_from)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS product_requests (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  biz_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  product_code VARCHAR(64) NOT NULL,
  title VARCHAR(500) NOT NULL,
  problem_statement TEXT NULL,
  source_type ENUM('customer','internal','engineering','other') NOT NULL DEFAULT 'internal',
  urgency_level ENUM('P0','P1','P2','P3') NOT NULL DEFAULT 'P2',
  decision_status ENUM('submitted','evaluating','accepted','deferred','rejected','merged') NOT NULL DEFAULT 'submitted',
  decision_reason TEXT NULL,
  decided_by VARCHAR(64) NULL,
  decided_at DATETIME(3) NULL,
  merged_into_id BIGINT UNSIGNED NULL,
  revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_by VARCHAR(64) NOT NULL,
  updated_by VARCHAR(64) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id), UNIQUE KEY uk_pc_request_biz (biz_id),
  UNIQUE KEY uk_pc_request_scope (id,product_code),
  KEY idx_pc_request_list (product_code,decision_status,id),
  CONSTRAINT fk_pc_request_product FOREIGN KEY (product_code) REFERENCES product_workspaces(product_code),
  CONSTRAINT fk_pc_request_merge FOREIGN KEY (merged_into_id,product_code) REFERENCES product_requests(id,product_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS product_request_sources (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  request_id BIGINT UNSIGNED NOT NULL,
  source_app VARCHAR(32) NULL,
  source_type VARCHAR(64) NOT NULL,
  source_biz_id VARCHAR(191) NULL,
  source_note TEXT NOT NULL,
  evidence_date DATE NULL,
  evidence_kind ENUM('fact','assumption') NOT NULL DEFAULT 'assumption',
  direction ENUM('supporting','opposing','neutral') NOT NULL DEFAULT 'neutral',
  verification_status ENUM('unverified','verified','unavailable') NOT NULL DEFAULT 'unverified',
  revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_by VARCHAR(64) NOT NULL,
  updated_by VARCHAR(64) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id), KEY idx_pc_source_request (request_id,id),
  CONSTRAINT fk_pc_source_request FOREIGN KEY (request_id) REFERENCES product_requests(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS product_features (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  biz_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  product_code VARCHAR(64) NOT NULL,
  title VARCHAR(500) NOT NULL,
  description TEXT NULL,
  lifecycle ENUM('candidate','active','deprecated') NOT NULL DEFAULT 'candidate',
  lifecycle_evidence JSON NULL,
  revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_by VARCHAR(64) NOT NULL,
  updated_by VARCHAR(64) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id), UNIQUE KEY uk_pc_feature_biz (biz_id),
  UNIQUE KEY uk_pc_feature_scope (id,product_code),
  KEY idx_pc_feature_list (product_code,lifecycle,id),
  CONSTRAINT fk_pc_feature_product FOREIGN KEY (product_code) REFERENCES product_workspaces(product_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS product_request_features (
  product_code VARCHAR(64) NOT NULL,
  request_id BIGINT UNSIGNED NOT NULL,
  product_feature_id BIGINT UNSIGNED NOT NULL,
  created_by VARCHAR(64) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (request_id,product_feature_id),
  CONSTRAINT fk_pc_rf_request FOREIGN KEY (request_id,product_code) REFERENCES product_requests(id,product_code),
  CONSTRAINT fk_pc_rf_feature FOREIGN KEY (product_feature_id,product_code) REFERENCES product_features(id,product_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS product_planning_cycles (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  biz_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  product_code VARCHAR(64) NOT NULL,
  title VARCHAR(255) NOT NULL,
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL,
  goal_summary TEXT NOT NULL,
  metric_definition JSON NULL,
  baseline_value DECIMAL(20,6) NULL,
  target_value DECIMAL(20,6) NULL,
  total_person_days DECIMAL(12,2) NULL,
  reserve_person_days DECIMAL(12,2) NULL,
  reliability_person_days DECIMAL(12,2) NULL,
  usability_person_days DECIMAL(12,2) NULL,
  growth_person_days DECIMAL(12,2) NULL,
  model_version VARCHAR(64) NOT NULL DEFAULT 'weighted-value-effort-v1',
  model_snapshot JSON NOT NULL,
  matrix_value_threshold DECIMAL(6,2) NOT NULL DEFAULT 50,
  matrix_effort_threshold DECIMAL(12,2) NOT NULL DEFAULT 5,
  review_interval_days SMALLINT UNSIGNED NOT NULL DEFAULT 14,
  next_review_at DATETIME(3) NULL,
  status ENUM('draft','open','closed') NOT NULL DEFAULT 'draft',
  open_product_code VARCHAR(64) GENERATED ALWAYS AS (CASE WHEN status='open' THEN product_code ELSE NULL END) STORED,
  queue_revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
  revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
  closed_snapshot JSON NULL,
  created_by VARCHAR(64) NOT NULL,
  updated_by VARCHAR(64) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id), UNIQUE KEY uk_pc_cycle_biz (biz_id),
  UNIQUE KEY uk_pc_cycle_scope (id,product_code),
  UNIQUE KEY uk_pc_cycle_open (open_product_code),
  KEY idx_pc_cycle_list (product_code,status,id),
  CONSTRAINT fk_pc_cycle_product FOREIGN KEY (product_code) REFERENCES product_workspaces(product_code),
  CONSTRAINT ck_pc_cycle_dates CHECK (ends_on >= starts_on),
  CONSTRAINT ck_pc_cycle_interval CHECK (review_interval_days BETWEEN 1 AND 366),
  CONSTRAINT ck_pc_cycle_nonnegative CHECK (
    total_person_days >= 0 AND reserve_person_days >= 0 AND reliability_person_days >= 0
    AND usability_person_days >= 0 AND growth_person_days >= 0),
  CONSTRAINT ck_pc_cycle_capacity CHECK (
    reserve_person_days + reliability_person_days + usability_person_days + growth_person_days <= total_person_days),
  CONSTRAINT ck_pc_cycle_open_capacity CHECK (status <> 'open' OR (
    total_person_days IS NOT NULL AND reserve_person_days IS NOT NULL AND reliability_person_days IS NOT NULL
    AND usability_person_days IS NOT NULL AND growth_person_days IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS product_planning_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  biz_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  product_code VARCHAR(64) NOT NULL,
  title VARCHAR(500) NOT NULL,
  scope_summary TEXT NOT NULL,
  feature_id BIGINT UNSIGNED NULL,
  derived_from_id BIGINT UNSIGNED NULL,
  merged_into_id BIGINT UNSIGNED NULL,
  urgency_level ENUM('P0','P1','P2','P3') NOT NULL DEFAULT 'P2',
  deadline DATE NULL,
  deadline_evidence JSON NULL,
  investment_category ENUM('reliability','usability','growth') NOT NULL,
  lifecycle ENUM('proposed','in_delivery','delivered','cancelled','merged') NOT NULL DEFAULT 'proposed',
  scope_revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
  evidence_revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
  revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_by VARCHAR(64) NOT NULL,
  updated_by VARCHAR(64) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id), UNIQUE KEY uk_pc_planning_biz (biz_id),
  UNIQUE KEY uk_pc_planning_scope (id,product_code),
  KEY idx_pc_planning_list (product_code,lifecycle,id),
  CONSTRAINT fk_pc_planning_product FOREIGN KEY (product_code) REFERENCES product_workspaces(product_code),
  CONSTRAINT fk_pc_planning_feature FOREIGN KEY (feature_id,product_code) REFERENCES product_features(id,product_code),
  CONSTRAINT fk_pc_planning_origin FOREIGN KEY (derived_from_id,product_code) REFERENCES product_planning_items(id,product_code),
  CONSTRAINT fk_pc_planning_merge FOREIGN KEY (merged_into_id,product_code) REFERENCES product_planning_items(id,product_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS product_planning_item_requests (
  product_code VARCHAR(64) NOT NULL,
  planning_item_id BIGINT UNSIGNED NOT NULL,
  request_id BIGINT UNSIGNED NOT NULL,
  created_by VARCHAR(64) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (planning_item_id,request_id),
  CONSTRAINT fk_pc_ir_item FOREIGN KEY (planning_item_id,product_code) REFERENCES product_planning_items(id,product_code),
  CONSTRAINT fk_pc_ir_request FOREIGN KEY (request_id,product_code) REFERENCES product_requests(id,product_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS product_planning_cycle_items (
  cycle_id BIGINT UNSIGNED NOT NULL,
  planning_item_id BIGINT UNSIGNED NOT NULL,
  product_code VARCHAR(64) NOT NULL,
  selection_status ENUM('candidate','selected','deferred') NOT NULL DEFAULT 'candidate',
  decision_rank BIGINT UNSIGNED NOT NULL,
  roadmap_bucket ENUM('now','next','later') NOT NULL DEFAULT 'later',
  current_assessment_id BIGINT UNSIGNED NULL,
  decision_snapshot JSON NULL,
  decided_by VARCHAR(64) NULL,
  decision_reason TEXT NULL,
  decided_at DATETIME(3) NULL,
  PRIMARY KEY (cycle_id,planning_item_id),
  UNIQUE KEY uk_pc_cycle_rank (cycle_id,decision_rank),
  CONSTRAINT fk_pc_ci_cycle FOREIGN KEY (cycle_id,product_code) REFERENCES product_planning_cycles(id,product_code),
  CONSTRAINT fk_pc_ci_item FOREIGN KEY (planning_item_id,product_code) REFERENCES product_planning_items(id,product_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS product_priority_assessments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  cycle_id BIGINT UNSIGNED NOT NULL,
  planning_item_id BIGINT UNSIGNED NOT NULL,
  scope_revision BIGINT UNSIGNED NOT NULL,
  evidence_revision BIGINT UNSIGNED NOT NULL,
  model_version VARCHAR(64) NOT NULL,
  model_snapshot JSON NOT NULL,
  strategic TINYINT UNSIGNED NULL,
  user_value TINYINT UNSIGNED NULL,
  business TINYINT UNSIGNED NULL,
  risk TINYINT UNSIGNED NULL,
  confidence DECIMAL(3,2) NULL,
  effort_person_days DECIMAL(12,2) NULL,
  effort_unit VARCHAR(16) NOT NULL DEFAULT 'person_day',
  value_score SMALLINT UNSIGNED NULL,
  priority_score DECIMAL(20,8) NULL,
  evidence_snapshot JSON NOT NULL,
  rationale JSON NOT NULL,
  assessed_by VARCHAR(64) NOT NULL,
  estimated_by VARCHAR(64) NULL,
  assessed_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id), UNIQUE KEY uk_pc_assessment_identity (id,cycle_id,planning_item_id),
  KEY idx_pc_assessment_history (cycle_id,planning_item_id,id),
  CONSTRAINT fk_pc_assessment_item FOREIGN KEY (cycle_id,planning_item_id) REFERENCES product_planning_cycle_items(cycle_id,planning_item_id),
  CONSTRAINT ck_pc_assessment_dimensions CHECK (strategic <= 5 AND user_value <= 5 AND business <= 5 AND risk <= 5),
  CONSTRAINT ck_pc_assessment_confidence CHECK (confidence IN (0.50,0.80,1.00)),
  CONSTRAINT ck_pc_assessment_effort CHECK (effort_person_days BETWEEN 0.50 AND 1000000.00),
  CONSTRAINT ck_pc_assessment_unit CHECK (effort_unit='person_day'),
  CONSTRAINT ck_pc_assessment_value CHECK (value_score <= 100),
  CONSTRAINT ck_pc_assessment_score CHECK (priority_score >= 0),
  CONSTRAINT ck_pc_assessment_complete CHECK (priority_score IS NULL OR (
    strategic IS NOT NULL AND user_value IS NOT NULL AND business IS NOT NULL AND risk IS NOT NULL
    AND confidence IS NOT NULL AND effort_person_days IS NOT NULL AND value_score IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS product_planning_dependencies (
  product_code VARCHAR(64) NOT NULL,
  planning_item_id BIGINT UNSIGNED NOT NULL,
  predecessor_id BIGINT UNSIGNED NOT NULL,
  created_by VARCHAR(64) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (planning_item_id,predecessor_id),
  CONSTRAINT fk_pc_dep_item FOREIGN KEY (planning_item_id,product_code) REFERENCES product_planning_items(id,product_code),
  CONSTRAINT fk_pc_dep_predecessor FOREIGN KEY (predecessor_id,product_code) REFERENCES product_planning_items(id,product_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS product_planning_comments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  planning_item_id BIGINT UNSIGNED NOT NULL,
  author_uid VARCHAR(64) NOT NULL,
  body TEXT NOT NULL,
  revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
  deleted_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id), KEY idx_pc_comment_item (planning_item_id,id),
  CONSTRAINT fk_pc_comment_item FOREIGN KEY (planning_item_id) REFERENCES product_planning_items(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS product_outcome_observations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  cycle_id BIGINT UNSIGNED NOT NULL,
  metric_snapshot JSON NOT NULL,
  observed_value DECIMAL(20,6) NULL,
  observed_at DATETIME(3) NOT NULL,
  evidence JSON NOT NULL,
  conclusion TEXT NOT NULL,
  correction_of_id BIGINT UNSIGNED NULL,
  recorded_by VARCHAR(64) NOT NULL,
  recorded_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id), UNIQUE KEY uk_pc_observation_scope (id,cycle_id),
  KEY idx_pc_observation_cycle (cycle_id,id),
  CONSTRAINT fk_pc_observation_cycle FOREIGN KEY (cycle_id) REFERENCES product_planning_cycles(id),
  CONSTRAINT fk_pc_observation_correction FOREIGN KEY (correction_of_id,cycle_id) REFERENCES product_outcome_observations(id,cycle_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS product_request_delivery_links (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  product_code VARCHAR(64) NOT NULL,
  planning_item_id BIGINT UNSIGNED NOT NULL,
  request_id BIGINT UNSIGNED NULL,
  project_id BIGINT UNSIGNED NOT NULL,
  requirement_id BIGINT UNSIGNED NOT NULL,
  source_revision BIGINT UNSIGNED NOT NULL,
  scope_snapshot JSON NOT NULL,
  delivery_slice_key VARCHAR(191) NOT NULL,
  planned_version_id BIGINT UNSIGNED NULL,
  planned_version_feature_id BIGINT UNSIGNED NULL,
  created_by VARCHAR(64) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_pc_delivery_slice (planning_item_id,project_id,delivery_slice_key),
  UNIQUE KEY uk_pc_delivery_requirement (planning_item_id,requirement_id),
  CONSTRAINT fk_pc_delivery_item FOREIGN KEY (planning_item_id,product_code) REFERENCES product_planning_items(id,product_code),
  CONSTRAINT fk_pc_delivery_request FOREIGN KEY (request_id,product_code) REFERENCES product_requests(id,product_code)
  -- project/requirement/version references are validated in the domain command;
  -- no cascading FK: project deletion must not erase product traceability.
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS product_activity_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  product_code VARCHAR(64) NOT NULL,
  object_type VARCHAR(64) NOT NULL,
  object_id VARCHAR(191) NOT NULL,
  action VARCHAR(64) NOT NULL,
  actor_uid VARCHAR(64) NOT NULL,
  revision BIGINT UNSIGNED NULL,
  changes JSON NOT NULL,
  request_id VARCHAR(191) NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id), KEY idx_pc_activity_product (product_code,id),
  KEY idx_pc_activity_object (product_code,object_type,object_id,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS product_command_receipts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  product_code VARCHAR(64) NOT NULL,
  action VARCHAR(64) NOT NULL,
  actor_uid VARCHAR(64) NOT NULL,
  idempotency_key VARCHAR(191) NOT NULL,
  execution_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  request_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status ENUM('processing','succeeded') NOT NULL,
  result_json JSON NULL,
  created_at DATETIME(3) NOT NULL,
  completed_at DATETIME(3) NULL,
  PRIMARY KEY (id), UNIQUE KEY uk_pc_command (product_code,action,actor_uid,idempotency_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS product_catalog_control (
  id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  CONSTRAINT ck_pc_catalog_singleton CHECK (id=1)
) ENGINE=InnoDB;
INSERT IGNORE INTO product_catalog_control(id) VALUES(1);

CREATE TABLE IF NOT EXISTS product_catalog_refreshes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  biz_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status ENUM('staging','active','superseded','failed') NOT NULL DEFAULT 'staging',
  active_slot TINYINT GENERATED ALWAYS AS (CASE WHEN status='active' THEN 1 ELSE NULL END) STORED,
  source_watermark VARCHAR(191) NULL,
  source_cursor VARCHAR(500) NULL,
  row_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_by VARCHAR(64) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  completed_at DATETIME(3) NULL,
  PRIMARY KEY (id), UNIQUE KEY uk_pc_refresh_biz (biz_id), UNIQUE KEY uk_pc_catalog_active (active_slot)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS product_catalog_page_receipts (
  generation BIGINT UNSIGNED NOT NULL,
  page_number INT UNSIGNED NOT NULL,
  request_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  result_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (generation,page_number),
  CONSTRAINT fk_pc_catalog_page_generation FOREIGN KEY (generation) REFERENCES product_catalog_refreshes(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS product_catalog_projection (
  generation BIGINT UNSIGNED NOT NULL,
  product_code VARCHAR(64) NOT NULL,
  product_name VARCHAR(255) NOT NULL,
  product_line VARCHAR(64) NOT NULL,
  product_line_label VARCHAR(255) NULL,
  product_line_sort_order INT NULL,
  source_status VARCHAR(64) NOT NULL,
  business_owner_uid VARCHAR(64) NULL,
  technical_owner_uid VARCHAR(64) NULL,
  source_updated_at DATETIME(3) NULL,
  synced_at DATETIME(3) NOT NULL,
  PRIMARY KEY (generation,product_code),
  KEY idx_pc_catalog_line (generation,product_line,product_code),
  CONSTRAINT fk_pc_catalog_generation FOREIGN KEY (generation) REFERENCES product_catalog_refreshes(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS product_version_acceptances (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  version_id BIGINT UNSIGNED NOT NULL,
  scope_revision BIGINT UNSIGNED NOT NULL,
  accepted_by VARCHAR(64) NOT NULL,
  accepted_at DATETIME(3) NOT NULL,
  checklist JSON NOT NULL,
  exceptions JSON NOT NULL,
  PRIMARY KEY (id), KEY idx_pc_acceptance_version (version_id,scope_revision,id),
  CONSTRAINT fk_pc_acceptance_version FOREIGN KEY (version_id) REFERENCES product_versions(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS product_release_records (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  biz_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  version_id BIGINT UNSIGNED NOT NULL,
  release_seq BIGINT UNSIGNED NOT NULL,
  scope_revision BIGINT UNSIGNED NOT NULL,
  scope_snapshot JSON NOT NULL,
  acceptance_snapshot JSON NOT NULL,
  content_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  released_by VARCHAR(64) NULL,
  released_at DATETIME(3) NULL,
  evidence_level ENUM('verified','legacy_import') NOT NULL,
  supersedes_record_id BIGINT UNSIGNED NULL,
  recorded_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id), UNIQUE KEY uk_pc_release_biz (biz_id),
  UNIQUE KEY uk_pc_release_seq (version_id,release_seq),
  UNIQUE KEY uk_pc_release_scope (id,version_id),
  CONSTRAINT fk_pc_release_version FOREIGN KEY (version_id) REFERENCES product_versions(id),
  CONSTRAINT fk_pc_release_supersedes FOREIGN KEY (supersedes_record_id,version_id) REFERENCES product_release_records(id,version_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS product_release_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  release_record_id BIGINT UNSIGNED NOT NULL,
  event_type ENUM('withdrawn','superseded') NOT NULL,
  actor_uid VARCHAR(64) NOT NULL,
  reason TEXT NOT NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id), KEY idx_pc_release_event (release_record_id,id),
  CONSTRAINT fk_pc_release_event FOREIGN KEY (release_record_id) REFERENCES product_release_records(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

DELIMITER $$
DROP PROCEDURE IF EXISTS aims_apply_v5_19$$
CREATE PROCEDURE aims_apply_v5_19()
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='product_versions' AND COLUMN_NAME='revision') THEN
    ALTER TABLE product_versions ADD COLUMN revision BIGINT UNSIGNED NOT NULL DEFAULT 1;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='product_versions' AND COLUMN_NAME='scope_revision') THEN
    ALTER TABLE product_versions ADD COLUMN scope_revision BIGINT UNSIGNED NOT NULL DEFAULT 1;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='product_versions' AND COLUMN_NAME='business_owner_uid') THEN
    ALTER TABLE product_versions ADD COLUMN business_owner_uid VARCHAR(64) NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='product_versions' AND COLUMN_NAME='current_release_record_id') THEN
    ALTER TABLE product_versions ADD COLUMN current_release_record_id BIGINT UNSIGNED NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='product_version_features' AND COLUMN_NAME='product_feature_id') THEN
    ALTER TABLE product_version_features ADD COLUMN product_feature_id BIGINT UNSIGNED NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='product_version_features' AND COLUMN_NAME='planning_item_id') THEN
    ALTER TABLE product_version_features ADD COLUMN planning_item_id BIGINT UNSIGNED NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='product_version_features' AND COLUMN_NAME='change_type') THEN
    ALTER TABLE product_version_features ADD COLUMN change_type ENUM('new','enhancement','fix','retirement') NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='product_version_features' AND COLUMN_NAME='acceptance_criteria') THEN
    ALTER TABLE product_version_features ADD COLUMN acceptance_criteria TEXT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='product_version_features' AND COLUMN_NAME='deferred_from_feature_id') THEN
    ALTER TABLE product_version_features ADD COLUMN deferred_from_feature_id BIGINT UNSIGNED NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='product_version_features' AND INDEX_NAME='uk_pc_version_feature') THEN
    ALTER TABLE product_version_features ADD UNIQUE KEY uk_pc_version_feature (version_id,product_feature_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='product_version_features' AND INDEX_NAME='uk_pc_version_planning') THEN
    ALTER TABLE product_version_features ADD UNIQUE KEY uk_pc_version_planning (planning_item_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='product_planning_cycle_items' AND CONSTRAINT_NAME='fk_pc_ci_assessment') THEN
    ALTER TABLE product_planning_cycle_items ADD CONSTRAINT fk_pc_ci_assessment FOREIGN KEY (current_assessment_id,cycle_id,planning_item_id) REFERENCES product_priority_assessments(id,cycle_id,planning_item_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='product_version_features' AND CONSTRAINT_NAME='fk_pc_vf_feature') THEN
    ALTER TABLE product_version_features ADD CONSTRAINT fk_pc_vf_feature FOREIGN KEY (product_feature_id) REFERENCES product_features(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='product_version_features' AND CONSTRAINT_NAME='fk_pc_vf_planning') THEN
    ALTER TABLE product_version_features ADD CONSTRAINT fk_pc_vf_planning FOREIGN KEY (planning_item_id) REFERENCES product_planning_items(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='product_version_features' AND CONSTRAINT_NAME='fk_pc_vf_deferred') THEN
    ALTER TABLE product_version_features ADD CONSTRAINT fk_pc_vf_deferred FOREIGN KEY (deferred_from_feature_id) REFERENCES product_version_features(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='product_versions' AND CONSTRAINT_NAME='fk_pc_version_release') THEN
    ALTER TABLE product_versions ADD CONSTRAINT fk_pc_version_release FOREIGN KEY (current_release_record_id,id) REFERENCES product_release_records(id,version_id);
  END IF;
END$$
CALL aims_apply_v5_19()$$
DROP PROCEDURE IF EXISTS aims_apply_v5_19$$
DELIMITER ;

-- Immutable evidence: correction is an appended record/event, never UPDATE/DELETE.
DELIMITER $$
DROP TRIGGER IF EXISTS pc_priority_assessments_no_update$$
CREATE TRIGGER pc_priority_assessments_no_update BEFORE UPDATE ON product_priority_assessments FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'product evidence is append-only';
END$$
DROP TRIGGER IF EXISTS pc_priority_assessments_no_delete$$
CREATE TRIGGER pc_priority_assessments_no_delete BEFORE DELETE ON product_priority_assessments FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'product evidence is append-only';
END$$
DROP TRIGGER IF EXISTS pc_version_acceptances_no_update$$
CREATE TRIGGER pc_version_acceptances_no_update BEFORE UPDATE ON product_version_acceptances FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'product evidence is append-only';
END$$
DROP TRIGGER IF EXISTS pc_version_acceptances_no_delete$$
CREATE TRIGGER pc_version_acceptances_no_delete BEFORE DELETE ON product_version_acceptances FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'product evidence is append-only';
END$$
DROP TRIGGER IF EXISTS pc_release_records_no_update$$
CREATE TRIGGER pc_release_records_no_update BEFORE UPDATE ON product_release_records FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'product evidence is append-only';
END$$
DROP TRIGGER IF EXISTS pc_release_records_no_delete$$
CREATE TRIGGER pc_release_records_no_delete BEFORE DELETE ON product_release_records FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'product evidence is append-only';
END$$
DROP TRIGGER IF EXISTS pc_release_events_no_update$$
CREATE TRIGGER pc_release_events_no_update BEFORE UPDATE ON product_release_events FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'product evidence is append-only';
END$$
DROP TRIGGER IF EXISTS pc_release_events_no_delete$$
CREATE TRIGGER pc_release_events_no_delete BEFORE DELETE ON product_release_events FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'product evidence is append-only';
END$$
DROP TRIGGER IF EXISTS pc_outcome_observations_no_update$$
CREATE TRIGGER pc_outcome_observations_no_update BEFORE UPDATE ON product_outcome_observations FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'product evidence is append-only';
END$$
DROP TRIGGER IF EXISTS pc_outcome_observations_no_delete$$
CREATE TRIGGER pc_outcome_observations_no_delete BEFORE DELETE ON product_outcome_observations FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'product evidence is append-only';
END$$
DROP TRIGGER IF EXISTS pc_activity_logs_no_update$$
CREATE TRIGGER pc_activity_logs_no_update BEFORE UPDATE ON product_activity_logs FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'product evidence is append-only';
END$$
DROP TRIGGER IF EXISTS pc_activity_logs_no_delete$$
CREATE TRIGGER pc_activity_logs_no_delete BEFORE DELETE ON product_activity_logs FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'product evidence is append-only';
END$$
DELIMITER ;
