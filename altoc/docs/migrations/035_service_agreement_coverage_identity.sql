-- ============================================================
-- Migration 035: Formal service agreement coverage identity
-- ============================================================
-- Run in hzy_altoc or the target Altoc tenant database after 034.
--
-- Scope:
-- - add service_agreement_coverage as the formal coverage truth
-- - keep service_agreement_asset for compatibility
-- - backfill old planned/customer/legacy asset coverages without treating
--   Altoc plan codes as formal Assets codes

CREATE TABLE IF NOT EXISTS service_agreement_coverage (
  id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
  coverage_code VARCHAR(64) NOT NULL COMMENT '服务覆盖关系编号',
  service_agreement_id BIGINT NOT NULL COMMENT '服务协议ID',
  target_type VARCHAR(40) NOT NULL DEFAULT 'pending_plan' COMMENT '目标类型：delivery_asset/environment/delivery_asset_environment/pending_plan/legacy',
  source_plan_code VARCHAR(100) DEFAULT NULL COMMENT 'Altoc合同计划资产编码',
  delivery_asset_code VARCHAR(100) DEFAULT NULL COMMENT 'Assets正式客户交付资产编码',
  environment_code VARCHAR(100) DEFAULT NULL COMMENT 'Assets正式环境编码',
  legacy_reference VARCHAR(255) DEFAULT NULL COMMENT '无法自动解析的旧引用',
  resolution_status VARCHAR(30) NOT NULL DEFAULT 'pending' COMMENT '解析状态：pending/resolved/needs_review',
  coverage_status VARCHAR(30) NOT NULL DEFAULT 'planned' COMMENT '覆盖状态：planned/active/suspended/ended/cancelled',
  coverage_scope VARCHAR(50) DEFAULT NULL COMMENT '覆盖范围',
  product_scope_json JSON DEFAULT NULL COMMENT '产品覆盖范围快照',
  effective_from DATE DEFAULT NULL COMMENT '生效日期',
  effective_to DATE DEFAULT NULL COMMENT '失效日期',
  included TINYINT NOT NULL DEFAULT 1 COMMENT '是否包含',
  exclusion_note VARCHAR(500) DEFAULT NULL COMMENT '排除说明',
  source_type VARCHAR(30) NOT NULL DEFAULT 'migration' COMMENT '来源类型：activation/migration/manual/renewal/callback',
  created_by VARCHAR(50) DEFAULT NULL COMMENT '创建人',
  updated_by VARCHAR(50) DEFAULT NULL COMMENT '更新人',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  deleted_at DATETIME DEFAULT NULL COMMENT '软删除时间',
  active_target_key VARCHAR(500) GENERATED ALWAYS AS (
    CASE
      WHEN deleted_at IS NULL AND coverage_status <> 'cancelled' THEN CONCAT(
        service_agreement_id, ':', target_type, ':',
        CASE
          WHEN target_type = 'pending_plan' THEN COALESCE(source_plan_code, '')
          WHEN target_type = 'legacy' THEN COALESCE(legacy_reference, '')
          ELSE ''
        END, ':',
        COALESCE(delivery_asset_code, ''), ':',
        COALESCE(environment_code, ''), ':',
        COALESCE(DATE_FORMAT(effective_from, '%Y-%m-%d'), ''), ':',
        COALESCE(DATE_FORMAT(effective_to, '%Y-%m-%d'), '')
      )
      ELSE NULL
    END
  ) STORED,
  UNIQUE KEY uk_service_agreement_coverage_code (coverage_code),
  UNIQUE KEY uk_service_agreement_coverage_target (active_target_key),
  INDEX idx_sac_agreement (service_agreement_id, coverage_status, resolution_status),
  INDEX idx_sac_source_plan (source_plan_code, resolution_status),
  INDEX idx_sac_delivery_asset (delivery_asset_code, coverage_status),
  INDEX idx_sac_environment (environment_code, coverage_status),
  INDEX idx_sac_resolution (resolution_status, target_type),
  CONSTRAINT fk_sac_agreement FOREIGN KEY (service_agreement_id) REFERENCES service_agreement(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='服务协议正式覆盖对象表';

SET @sac_active_key_needs_refresh := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'service_agreement_coverage'
    AND COLUMN_NAME = 'active_target_key'
    AND GENERATION_EXPRESSION NOT LIKE '%legacy_reference%'
);

SET @sac_active_key_refresh_sql := IF(
  @sac_active_key_needs_refresh > 0,
  'ALTER TABLE service_agreement_coverage
     DROP INDEX uk_service_agreement_coverage_target,
     DROP COLUMN active_target_key,
     ADD COLUMN active_target_key VARCHAR(500) GENERATED ALWAYS AS (
       CASE
         WHEN deleted_at IS NULL AND coverage_status <> ''cancelled'' THEN CONCAT(
           service_agreement_id, '':'', target_type, '':'',
           CASE
             WHEN target_type = ''pending_plan'' THEN COALESCE(source_plan_code, '''')
             WHEN target_type = ''legacy'' THEN COALESCE(legacy_reference, '''')
             ELSE ''''
           END, '':'',
           COALESCE(delivery_asset_code, ''''), '':'',
           COALESCE(environment_code, ''''), '':'',
           COALESCE(DATE_FORMAT(effective_from, ''%Y-%m-%d''), ''''), '':'',
           COALESCE(DATE_FORMAT(effective_to, ''%Y-%m-%d''), '''')
         )
         ELSE NULL
       END
     ) STORED,
     ADD UNIQUE KEY uk_service_agreement_coverage_target (active_target_key)',
  'SELECT 1'
);
PREPARE stmt FROM @sac_active_key_refresh_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

INSERT INTO service_agreement_coverage (
  coverage_code,
  service_agreement_id,
  target_type,
  source_plan_code,
  delivery_asset_code,
  environment_code,
  legacy_reference,
  resolution_status,
  coverage_status,
  effective_from,
  effective_to,
  included,
  exclusion_note,
  source_type,
  created_by,
  updated_by
)
SELECT
  CONCAT('SAC-LEGACY-', saa.id),
  saa.service_agreement_id,
  CASE
    WHEN saa.coverage_type = 'legacy_delivery' THEN 'legacy'
    WHEN saa.coverage_type IN ('planned_asset', 'pending_asset')
      AND dap.external_asset_code IS NOT NULL AND dap.external_asset_code <> ''
      AND dap.environment_code IS NOT NULL AND dap.environment_code <> '' THEN 'delivery_asset_environment'
    WHEN saa.coverage_type IN ('planned_asset', 'pending_asset')
      AND dap.external_asset_code IS NOT NULL AND dap.external_asset_code <> '' THEN 'delivery_asset'
    WHEN saa.coverage_type = 'customer_delivery_asset' THEN 'delivery_asset'
    ELSE 'pending_plan'
  END,
  CASE
    WHEN saa.coverage_type IN ('planned_asset', 'pending_asset') THEN saa.delivery_asset_code
    WHEN dap.code IS NOT NULL THEN dap.code
    ELSE NULL
  END,
  CASE
    WHEN saa.coverage_type = 'customer_delivery_asset' THEN saa.delivery_asset_code
    WHEN saa.coverage_type IN ('planned_asset', 'pending_asset') THEN NULLIF(dap.external_asset_code, '')
    ELSE NULL
  END,
  CASE
    WHEN saa.coverage_type IN ('planned_asset', 'pending_asset') THEN NULLIF(dap.environment_code, '')
    ELSE NULL
  END,
  CASE
    WHEN saa.coverage_type = 'legacy_delivery' THEN saa.delivery_asset_code
    ELSE NULL
  END,
  CASE
    WHEN saa.coverage_type = 'legacy_delivery' THEN 'needs_review'
    WHEN saa.coverage_type = 'customer_delivery_asset' THEN 'resolved'
    WHEN saa.coverage_type IN ('planned_asset', 'pending_asset') AND dap.external_asset_code IS NOT NULL AND dap.external_asset_code <> '' THEN 'resolved'
    ELSE 'pending'
  END,
  CASE
    WHEN saa.coverage_type = 'legacy_delivery' THEN 'planned'
    WHEN saa.coverage_type IN ('planned_asset', 'pending_asset') AND (dap.external_asset_code IS NULL OR dap.external_asset_code = '') THEN 'planned'
    ELSE
      CASE WHEN sa.status = 'active' THEN 'active' ELSE 'planned' END
  END,
  saa.coverage_start_date,
  saa.coverage_end_date,
  saa.included,
  saa.exclusion_note,
  'migration',
  'migration_035',
  'migration_035'
FROM service_agreement_asset saa
INNER JOIN service_agreement sa ON sa.id = saa.service_agreement_id
LEFT JOIN contract_delivery_asset_plan dap
  ON dap.contract_id = sa.contract_id
 AND dap.deleted_at IS NULL
 AND (dap.code = saa.delivery_asset_code OR dap.external_asset_code = saa.delivery_asset_code)
WHERE saa.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM service_agreement_coverage sac
    WHERE sac.coverage_code = CONCAT('SAC-LEGACY-', saa.id)
  )
ON DUPLICATE KEY UPDATE
  updated_at = CURRENT_TIMESTAMP;

SELECT
  (SELECT COUNT(*) FROM service_agreement_asset WHERE deleted_at IS NULL) AS legacy_coverage_total,
  (SELECT COUNT(*) FROM service_agreement_coverage WHERE deleted_at IS NULL AND target_type = 'delivery_asset' AND resolution_status = 'resolved') AS resolved_delivery_asset_count,
  (SELECT COUNT(*) FROM service_agreement_coverage WHERE deleted_at IS NULL AND target_type = 'environment' AND resolution_status = 'resolved') AS resolved_environment_count,
  (SELECT COUNT(*) FROM service_agreement_coverage WHERE deleted_at IS NULL AND target_type = 'delivery_asset_environment' AND resolution_status = 'resolved') AS resolved_pair_count,
  (SELECT COUNT(*) FROM service_agreement_coverage WHERE deleted_at IS NULL AND target_type = 'pending_plan') AS pending_plan_count,
  (SELECT COUNT(*) FROM service_agreement_coverage WHERE deleted_at IS NULL AND resolution_status = 'needs_review') AS needs_review_count,
  (SELECT COUNT(*)
   FROM service_agreement_coverage
   WHERE deleted_at IS NULL
     AND coverage_status = 'active'
     AND (
       resolution_status <> 'resolved'
       OR (
         target_type = 'delivery_asset'
         AND (delivery_asset_code IS NULL OR delivery_asset_code = '')
       )
       OR (
         target_type = 'environment'
         AND (environment_code IS NULL OR environment_code = '')
       )
       OR (
         target_type = 'delivery_asset_environment'
         AND (
           delivery_asset_code IS NULL OR delivery_asset_code = ''
           OR environment_code IS NULL OR environment_code = ''
         )
       )
     )) AS active_unresolved_count,
  (SELECT COUNT(*)
   FROM service_agreement_coverage
   WHERE deleted_at IS NULL
     AND (
       delivery_asset_code LIKE 'DAP-%'
       OR delivery_asset_code LIKE 'CDAP-%'
       OR environment_code LIKE 'DAP-%'
       OR environment_code LIKE 'CDAP-%'
     )) AS formal_target_plan_code_conflict_count,
  (SELECT COUNT(*)
   FROM service_agreement_coverage sac
   INNER JOIN service_agreement sa ON sa.id = sac.service_agreement_id
   INNER JOIN contract_delivery_asset_plan dap ON dap.code = sac.source_plan_code
   WHERE sac.deleted_at IS NULL
     AND sa.customer_code IS NOT NULL
     AND sa.customer_code <> ''
     AND dap.customer_code IS NOT NULL
     AND dap.customer_code <> ''
     AND sa.customer_code <> dap.customer_code) AS source_plan_customer_conflict_count,
  (SELECT COUNT(*)
   FROM (
     SELECT service_agreement_id, target_type,
            CASE
              WHEN target_type = 'pending_plan' THEN COALESCE(source_plan_code, '')
              WHEN target_type = 'legacy' THEN COALESCE(legacy_reference, '')
              ELSE ''
            END AS source_or_legacy_reference,
            COALESCE(delivery_asset_code, '') AS delivery_asset_code,
            COALESCE(environment_code, '') AS environment_code,
            COALESCE(effective_from, '1000-01-01') AS effective_from,
            COALESCE(effective_to, '9999-12-31') AS effective_to
     FROM service_agreement_coverage
     WHERE deleted_at IS NULL
       AND coverage_status <> 'cancelled'
     GROUP BY service_agreement_id, target_type,
              CASE
                WHEN target_type = 'pending_plan' THEN COALESCE(source_plan_code, '')
                WHEN target_type = 'legacy' THEN COALESCE(legacy_reference, '')
                ELSE ''
              END,
              COALESCE(delivery_asset_code, ''), COALESCE(environment_code, ''),
              COALESCE(effective_from, '1000-01-01'), COALESCE(effective_to, '9999-12-31')
     HAVING COUNT(*) > 1
   ) duplicate_target) AS duplicate_effective_coverage_count,
  (SELECT COUNT(*)
   FROM service_agreement_asset saa
   LEFT JOIN service_agreement_coverage sac ON sac.coverage_code = CONCAT('SAC-LEGACY-', saa.id)
   WHERE saa.deleted_at IS NULL AND sac.id IS NULL) AS unmatched_legacy_count,
  (SELECT COUNT(*)
   FROM service_agreement_coverage sac
   LEFT JOIN service_agreement sa ON sa.id = sac.service_agreement_id
   WHERE sac.deleted_at IS NULL AND sa.id IS NULL) AS orphan_service_agreement_count;
