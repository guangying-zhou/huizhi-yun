-- ============================================================
-- Migration 031: Service agreement coverage for tickets and SLA
-- ============================================================
-- Run in hzy_altoc or the target Altoc tenant database after 030.
--
-- P1-4 scope:
-- - carry SLA/quota/renewal fields on service_agreement
-- - link service_ticket to service_agreement and covered customer asset
-- - migrate legacy maintenance_contract/service_entitlement data where a source
--   contract is available

DELIMITER $$

CREATE PROCEDURE hzy_p1_service_add_column(
  IN p_table_name VARCHAR(64),
  IN p_column_name VARCHAR(64),
  IN p_ddl TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = p_table_name
      AND COLUMN_NAME = p_column_name
  ) THEN
    SET @ddl = p_ddl;
    PREPARE stmt FROM @ddl;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END$$

CREATE PROCEDURE hzy_p1_service_add_index(
  IN p_table_name VARCHAR(64),
  IN p_index_name VARCHAR(64),
  IN p_ddl TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = p_table_name
      AND INDEX_NAME = p_index_name
  ) THEN
    SET @ddl = p_ddl;
    PREPARE stmt FROM @ddl;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END$$

CREATE PROCEDURE hzy_p1_service_add_fk(
  IN p_table_name VARCHAR(64),
  IN p_constraint_name VARCHAR(64),
  IN p_ddl TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE()
      AND TABLE_NAME = p_table_name
      AND CONSTRAINT_NAME = p_constraint_name
  ) THEN
    SET @ddl = p_ddl;
    PREPARE stmt FROM @ddl;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END$$

DELIMITER ;

CALL hzy_p1_service_add_column('service_agreement', 'response_minutes', 'ALTER TABLE service_agreement ADD COLUMN response_minutes INT DEFAULT NULL COMMENT ''默认响应时限(分钟)'' AFTER renewal_policy');
CALL hzy_p1_service_add_column('service_agreement', 'resolution_minutes', 'ALTER TABLE service_agreement ADD COLUMN resolution_minutes INT DEFAULT NULL COMMENT ''默认解决时限(分钟)'' AFTER response_minutes');
CALL hzy_p1_service_add_column('service_agreement', 'included_quota', 'ALTER TABLE service_agreement ADD COLUMN included_quota DECIMAL(10,2) DEFAULT NULL COMMENT ''包含工单额度'' AFTER resolution_minutes');
CALL hzy_p1_service_add_column('service_agreement', 'quota_unit', 'ALTER TABLE service_agreement ADD COLUMN quota_unit VARCHAR(30) DEFAULT NULL COMMENT ''额度单位：ticket/hour/day'' AFTER included_quota');
CALL hzy_p1_service_add_column('service_agreement', 'consumed_quota', 'ALTER TABLE service_agreement ADD COLUMN consumed_quota DECIMAL(10,2) NOT NULL DEFAULT 0.00 COMMENT ''已消耗额度'' AFTER quota_unit');
CALL hzy_p1_service_add_column('service_agreement', 'renewal_remind_at', 'ALTER TABLE service_agreement ADD COLUMN renewal_remind_at DATE DEFAULT NULL COMMENT ''续约提醒日期'' AFTER consumed_quota');
CALL hzy_p1_service_add_column('service_agreement', 'maintenance_contract_id', 'ALTER TABLE service_agreement ADD COLUMN maintenance_contract_id BIGINT DEFAULT NULL COMMENT ''来源维保合同ID'' AFTER owner_user_id');
CALL hzy_p1_service_add_index('service_agreement', 'idx_service_agreement_maintenance', 'CREATE INDEX idx_service_agreement_maintenance ON service_agreement (maintenance_contract_id)');
CALL hzy_p1_service_add_index('service_agreement', 'idx_service_agreement_renewal', 'CREATE INDEX idx_service_agreement_renewal ON service_agreement (renewal_remind_at, status)');

CALL hzy_p1_service_add_column('service_entitlement', 'service_agreement_id', 'ALTER TABLE service_entitlement ADD COLUMN service_agreement_id BIGINT DEFAULT NULL COMMENT ''迁移后的服务协议ID'' AFTER maintenance_contract_id');
CALL hzy_p1_service_add_index('service_entitlement', 'idx_service_agreement_id', 'CREATE INDEX idx_service_agreement_id ON service_entitlement (service_agreement_id)');
CALL hzy_p1_service_add_fk('service_entitlement', 'fk_se_service_agreement', 'ALTER TABLE service_entitlement ADD CONSTRAINT fk_se_service_agreement FOREIGN KEY (service_agreement_id) REFERENCES service_agreement(id) ON DELETE SET NULL');

CALL hzy_p1_service_add_column('service_ticket', 'service_agreement_id', 'ALTER TABLE service_ticket ADD COLUMN service_agreement_id BIGINT DEFAULT NULL COMMENT ''服务协议ID'' AFTER contract_id');
CALL hzy_p1_service_add_column('service_ticket', 'service_agreement_code', 'ALTER TABLE service_ticket ADD COLUMN service_agreement_code VARCHAR(64) DEFAULT NULL COMMENT ''服务协议编号快照'' AFTER service_agreement_id');
CALL hzy_p1_service_add_column('service_ticket', 'delivery_asset_code', 'ALTER TABLE service_ticket ADD COLUMN delivery_asset_code VARCHAR(100) DEFAULT NULL COMMENT ''客户交付资产编码'' AFTER delivery_code');
CALL hzy_p1_service_add_column('service_ticket', 'entitlement_status', 'ALTER TABLE service_ticket ADD COLUMN entitlement_status VARCHAR(30) NOT NULL DEFAULT ''unknown'' COMMENT ''权益状态：unknown/in_service/out_of_service/over_quota'' AFTER sla_status');
CALL hzy_p1_service_add_column('service_ticket', 'quota_consumed', 'ALTER TABLE service_ticket ADD COLUMN quota_consumed DECIMAL(10,2) NOT NULL DEFAULT 0.00 COMMENT ''本工单已扣减额度'' AFTER entitlement_status');
CALL hzy_p1_service_add_index('service_ticket', 'idx_service_agreement_id', 'CREATE INDEX idx_service_agreement_id ON service_ticket (service_agreement_id)');
CALL hzy_p1_service_add_index('service_ticket', 'idx_service_agreement_code', 'CREATE INDEX idx_service_agreement_code ON service_ticket (service_agreement_code)');
CALL hzy_p1_service_add_index('service_ticket', 'idx_delivery_asset_code', 'CREATE INDEX idx_delivery_asset_code ON service_ticket (delivery_asset_code)');
CALL hzy_p1_service_add_index('service_ticket', 'idx_entitlement_status', 'CREATE INDEX idx_entitlement_status ON service_ticket (entitlement_status)');
CALL hzy_p1_service_add_fk('service_ticket', 'fk_st_service_agreement', 'ALTER TABLE service_ticket ADD CONSTRAINT fk_st_service_agreement FOREIGN KEY (service_agreement_id) REFERENCES service_agreement(id) ON DELETE SET NULL');

INSERT INTO service_agreement (
  code,
  contract_id,
  contract_line_id,
  customer_code,
  name,
  service_level,
  service_start_date,
  service_end_date,
  service_window,
  billing_mode,
  renewal_policy,
  response_minutes,
  resolution_minutes,
  included_quota,
  quota_unit,
  consumed_quota,
  renewal_remind_at,
  status,
  owner_user_id,
  maintenance_contract_id,
  created_by,
  updated_by
)
SELECT
  CONCAT('SA-MC-', mc.id),
  mc.contract_id,
  NULL,
  cu.code,
  mc.name,
  mc.service_level,
  mc.service_start_date,
  mc.service_end_date,
  MAX(se.service_window),
  COALESCE(MAX(se.billing_mode), 'included'),
  'legacy_maintenance_renewal',
  MIN(CASE WHEN se.status = 'active' THEN se.response_minutes ELSE NULL END),
  MIN(CASE WHEN se.status = 'active' THEN se.resolution_minutes ELSE NULL END),
  NULLIF(SUM(CASE WHEN se.status = 'active' THEN COALESCE(se.included_quota, 0) ELSE 0 END), 0),
  MAX(CASE WHEN se.status = 'active' THEN se.quota_unit ELSE NULL END),
  0.00,
  mc.renewal_remind_at,
  CASE mc.status
    WHEN 'active' THEN 'active'
    WHEN 'expiring' THEN 'active'
    WHEN 'expired' THEN 'expired'
    WHEN 'terminated' THEN 'terminated'
    ELSE 'planned'
  END,
  mc.owner_user_id,
  mc.id,
  COALESCE(mc.created_by, 'migration_031'),
  COALESCE(mc.updated_by, 'migration_031')
FROM maintenance_contract mc
INNER JOIN customer cu ON cu.id = mc.customer_id
LEFT JOIN service_entitlement se ON se.maintenance_contract_id = mc.id
WHERE mc.deleted_at IS NULL
  AND mc.contract_id IS NOT NULL
GROUP BY
  mc.id,
  mc.contract_id,
  cu.code,
  mc.name,
  mc.service_level,
  mc.service_start_date,
  mc.service_end_date,
  mc.renewal_remind_at,
  mc.status,
  mc.owner_user_id,
  mc.created_by,
  mc.updated_by
ON DUPLICATE KEY UPDATE
  customer_code = VALUES(customer_code),
  name = VALUES(name),
  service_level = VALUES(service_level),
  service_start_date = VALUES(service_start_date),
  service_end_date = VALUES(service_end_date),
  service_window = COALESCE(VALUES(service_window), service_window),
  billing_mode = COALESCE(VALUES(billing_mode), billing_mode),
  response_minutes = COALESCE(VALUES(response_minutes), response_minutes),
  resolution_minutes = COALESCE(VALUES(resolution_minutes), resolution_minutes),
  included_quota = COALESCE(VALUES(included_quota), included_quota),
  quota_unit = COALESCE(VALUES(quota_unit), quota_unit),
  renewal_remind_at = COALESCE(VALUES(renewal_remind_at), renewal_remind_at),
  status = VALUES(status),
  owner_user_id = COALESCE(VALUES(owner_user_id), owner_user_id),
  maintenance_contract_id = VALUES(maintenance_contract_id),
  updated_by = VALUES(updated_by),
  updated_at = CURRENT_TIMESTAMP,
  deleted_at = NULL;

UPDATE service_entitlement se
INNER JOIN maintenance_contract mc ON mc.id = se.maintenance_contract_id
INNER JOIN service_agreement sa ON sa.maintenance_contract_id = mc.id
SET se.service_agreement_id = sa.id,
    se.updated_by = COALESCE(se.updated_by, 'migration_031'),
    se.updated_at = CURRENT_TIMESTAMP
WHERE se.service_agreement_id IS NULL;

INSERT INTO service_agreement_asset (
  service_agreement_id,
  delivery_asset_code,
  coverage_type,
  coverage_start_date,
  coverage_end_date,
  included,
  created_by,
  updated_by
)
SELECT
  sa.id,
  COALESCE(NULLIF(mc.delivery_code, ''), CONCAT('pending-maintenance-', mc.code)),
  CASE WHEN mc.delivery_code IS NULL OR mc.delivery_code = '' THEN 'pending_asset' ELSE 'legacy_delivery' END,
  sa.service_start_date,
  sa.service_end_date,
  1,
  'migration_031',
  'migration_031'
FROM service_agreement sa
INNER JOIN maintenance_contract mc ON mc.id = sa.maintenance_contract_id
WHERE sa.deleted_at IS NULL
  AND mc.deleted_at IS NULL
ON DUPLICATE KEY UPDATE
  coverage_start_date = COALESCE(VALUES(coverage_start_date), coverage_start_date),
  coverage_end_date = COALESCE(VALUES(coverage_end_date), coverage_end_date),
  included = 1,
  updated_by = VALUES(updated_by),
  updated_at = CURRENT_TIMESTAMP,
  deleted_at = NULL;

UPDATE service_ticket st
INNER JOIN maintenance_contract mc ON mc.id = st.maintenance_contract_id
INNER JOIN service_agreement sa ON sa.maintenance_contract_id = mc.id
SET st.service_agreement_id = COALESCE(st.service_agreement_id, sa.id),
    st.service_agreement_code = COALESCE(st.service_agreement_code, sa.code),
    st.delivery_asset_code = COALESCE(st.delivery_asset_code, st.delivery_code, mc.delivery_code),
    st.entitlement_status = CASE
      WHEN sa.status = 'active'
       AND (sa.service_start_date IS NULL OR sa.service_start_date <= CURRENT_DATE)
       AND (sa.service_end_date IS NULL OR sa.service_end_date >= CURRENT_DATE)
       AND (sa.included_quota IS NULL OR COALESCE(sa.consumed_quota, 0) < sa.included_quota)
      THEN 'in_service'
      WHEN sa.included_quota IS NOT NULL AND COALESCE(sa.consumed_quota, 0) >= sa.included_quota
      THEN 'over_quota'
      ELSE 'out_of_service'
    END,
    st.response_due_at = COALESCE(
      st.response_due_at,
      DATE_ADD(st.created_at, INTERVAL COALESCE(
        sa.response_minutes,
        CASE st.priority
          WHEN 'urgent' THEN 30
          WHEN 'high' THEN 120
          WHEN 'low' THEN 480
          ELSE 240
        END
      ) MINUTE)
    ),
    st.resolution_due_at = COALESCE(
      st.resolution_due_at,
      DATE_ADD(st.created_at, INTERVAL COALESCE(
        sa.resolution_minutes,
        CASE st.priority
          WHEN 'urgent' THEN 240
          WHEN 'high' THEN 480
          WHEN 'low' THEN 4320
          ELSE 1440
        END
      ) MINUTE)
    ),
    st.sla_status = CASE
      WHEN st.status IN ('resolved', 'closed') AND st.sla_status <> 'breached' THEN 'met'
      WHEN st.status NOT IN ('resolved', 'closed', 'cancelled')
       AND st.resolution_due_at IS NOT NULL
       AND st.resolution_due_at < CURRENT_TIMESTAMP THEN 'breached'
      WHEN st.status NOT IN ('resolved', 'closed', 'cancelled')
       AND st.entitlement_status <> 'in_service' THEN 'warning'
      ELSE COALESCE(NULLIF(st.sla_status, 'not_started'), 'on_track')
    END,
    st.updated_by = COALESCE(st.updated_by, 'migration_031'),
    st.updated_at = CURRENT_TIMESTAMP
WHERE st.deleted_at IS NULL
  AND st.service_agreement_id IS NULL;

UPDATE service_ticket st
INNER JOIN service_agreement sa ON sa.id = st.service_agreement_id
SET st.sla_status = CASE
      WHEN st.status IN ('resolved', 'closed') AND st.sla_status <> 'breached' THEN 'met'
      WHEN st.status NOT IN ('resolved', 'closed', 'cancelled')
       AND st.resolution_due_at IS NOT NULL
       AND st.resolution_due_at < CURRENT_TIMESTAMP THEN 'breached'
      WHEN st.status NOT IN ('resolved', 'closed', 'cancelled')
       AND st.entitlement_status <> 'in_service' THEN 'warning'
      ELSE COALESCE(NULLIF(st.sla_status, 'not_started'), 'on_track')
    END,
    st.updated_at = CURRENT_TIMESTAMP
WHERE st.deleted_at IS NULL
  AND sa.deleted_at IS NULL;

DROP PROCEDURE hzy_p1_service_add_fk;
DROP PROCEDURE hzy_p1_service_add_index;
DROP PROCEDURE hzy_p1_service_add_column;
