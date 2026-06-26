-- ============================================================
-- Migration 034: Structured fulfillment project relations
-- ============================================================
-- Run in hzy_altoc or the target Altoc tenant database after 033.
--
-- Scope:
-- - make contract_project_link -> contract_line / contract_obligation
--   associations queryable without using JSON snapshots as the primary truth
-- - add service_agreement -> Aims project bindings for service ticket routing
-- - idempotently backfill the new relation tables from direct IDs and JSON code
--   snapshots while keeping the old JSON fields for compatibility

CREATE TABLE IF NOT EXISTS contract_project_line_rel (
  id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
  contract_project_link_id BIGINT NOT NULL COMMENT '合同项目关联ID',
  contract_line_id BIGINT NOT NULL COMMENT '合同行ID',
  relation_type VARCHAR(30) NOT NULL DEFAULT 'delivery' COMMENT '关系类型：delivery/customization/training/warranty/maintenance/change/other',
  allocation_method VARCHAR(30) NOT NULL DEFAULT 'unallocated' COMMENT '分摊方法：unallocated/direct/ratio/amount/workdays',
  allocation_ratio DECIMAL(8,4) DEFAULT NULL COMMENT '分摊比例(%)',
  allocated_amount DECIMAL(18,2) DEFAULT NULL COMMENT '分摊金额',
  planned_workdays DECIMAL(10,2) DEFAULT NULL COMMENT '计划人天',
  created_by VARCHAR(50) DEFAULT NULL COMMENT '创建人',
  updated_by VARCHAR(50) DEFAULT NULL COMMENT '更新人',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  deleted_at DATETIME DEFAULT NULL COMMENT '软删除时间',
  UNIQUE KEY uk_contract_project_line_rel (contract_project_link_id, contract_line_id, relation_type),
  INDEX idx_cplr_line (contract_line_id),
  INDEX idx_cplr_link (contract_project_link_id),
  INDEX idx_cplr_method (allocation_method),
  CONSTRAINT fk_cplr_link FOREIGN KEY (contract_project_link_id) REFERENCES contract_project_link(id) ON DELETE RESTRICT,
  CONSTRAINT fk_cplr_line FOREIGN KEY (contract_line_id) REFERENCES contract_line(id) ON DELETE RESTRICT,
  CHECK (allocation_ratio IS NULL OR allocation_ratio >= 0),
  CHECK (allocated_amount IS NULL OR allocated_amount >= 0),
  CHECK (planned_workdays IS NULL OR planned_workdays >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='合同项目-合同行结构化关系表';

CREATE TABLE IF NOT EXISTS contract_project_obligation_rel (
  id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
  contract_project_link_id BIGINT NOT NULL COMMENT '合同项目关联ID',
  obligation_id BIGINT NOT NULL COMMENT '履约义务ID',
  created_by VARCHAR(50) DEFAULT NULL COMMENT '创建人',
  updated_by VARCHAR(50) DEFAULT NULL COMMENT '更新人',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  deleted_at DATETIME DEFAULT NULL COMMENT '软删除时间',
  UNIQUE KEY uk_contract_project_obligation_rel (contract_project_link_id, obligation_id),
  INDEX idx_cpor_obligation (obligation_id),
  INDEX idx_cpor_link (contract_project_link_id),
  CONSTRAINT fk_cpor_link FOREIGN KEY (contract_project_link_id) REFERENCES contract_project_link(id) ON DELETE RESTRICT,
  CONSTRAINT fk_cpor_obligation FOREIGN KEY (obligation_id) REFERENCES contract_obligation(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='合同项目-履约义务结构化关系表';

CREATE TABLE IF NOT EXISTS service_agreement_project_rel (
  id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
  service_agreement_id BIGINT NOT NULL COMMENT '服务协议ID',
  project_code VARCHAR(64) NOT NULL COMMENT 'Aims项目编号',
  project_role VARCHAR(30) NOT NULL DEFAULT 'maintenance' COMMENT '项目角色：maintenance/operation/inspection/upgrade/special',
  is_default TINYINT NOT NULL DEFAULT 0 COMMENT '是否默认项目',
  effective_from DATE DEFAULT NULL COMMENT '生效日期',
  effective_to DATE DEFAULT NULL COMMENT '失效日期',
  status VARCHAR(30) NOT NULL DEFAULT 'active' COMMENT '状态：planned/active/suspended/ended',
  source_type VARCHAR(30) NOT NULL DEFAULT 'manual' COMMENT '来源类型：activation/manual/migration/ticket_resolution',
  created_by VARCHAR(50) DEFAULT NULL COMMENT '创建人',
  updated_by VARCHAR(50) DEFAULT NULL COMMENT '更新人',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  deleted_at DATETIME DEFAULT NULL COMMENT '软删除时间',
  UNIQUE KEY uk_service_agreement_project_role (service_agreement_id, project_code, project_role),
  INDEX idx_sapr_agreement (service_agreement_id, status, is_default),
  INDEX idx_sapr_project (project_code, status),
  INDEX idx_sapr_effective (service_agreement_id, project_role, effective_from, effective_to),
  CONSTRAINT fk_sapr_agreement FOREIGN KEY (service_agreement_id) REFERENCES service_agreement(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='服务协议-Aims项目关系表';

DROP PROCEDURE IF EXISTS hzy_034_backfill_contract_project_line_codes;
DROP PROCEDURE IF EXISTS hzy_034_backfill_contract_project_obligation_codes;

DELIMITER $$

CREATE PROCEDURE hzy_034_backfill_contract_project_line_codes()
BEGIN
  DECLARE done INT DEFAULT 0;
  DECLARE v_link_id BIGINT;
  DECLARE v_contract_id BIGINT;
  DECLARE v_project_role VARCHAR(30);
  DECLARE v_json JSON;
  DECLARE v_index INT DEFAULT 0;
  DECLARE v_count INT DEFAULT 0;
  DECLARE v_code VARCHAR(100);

  DECLARE cur CURSOR FOR
    SELECT id, contract_id, project_role, line_codes_json
    FROM contract_project_link
    WHERE deleted_at IS NULL
      AND line_codes_json IS NOT NULL
      AND JSON_VALID(line_codes_json);
  DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = 1;

  OPEN cur;
  read_loop: LOOP
    FETCH cur INTO v_link_id, v_contract_id, v_project_role, v_json;
    IF done = 1 THEN
      LEAVE read_loop;
    END IF;

    SET v_index = 0;
    SET v_count = COALESCE(JSON_LENGTH(v_json), 0);
    WHILE v_index < v_count DO
      SET v_code = TRIM(BOTH '"' FROM JSON_UNQUOTE(JSON_EXTRACT(v_json, CONCAT('$[', v_index, ']'))));
      IF v_code IS NOT NULL AND v_code <> '' THEN
        INSERT INTO contract_project_line_rel (
          contract_project_link_id,
          contract_line_id,
          relation_type,
          allocation_method,
          created_by,
          updated_by
        )
        SELECT
          v_link_id,
          cl.id,
          CASE
            WHEN v_project_role IN ('development', 'customization') THEN 'customization'
            WHEN v_project_role = 'training' THEN 'training'
            WHEN v_project_role = 'warranty' THEN 'warranty'
            WHEN v_project_role IN ('maintenance', 'operation') THEN 'maintenance'
            WHEN v_project_role = 'change' THEN 'change'
            WHEN v_project_role IN ('primary', 'delivery', 'implementation') THEN 'delivery'
            ELSE 'other'
          END,
          'unallocated',
          'migration_034',
          'migration_034'
        FROM contract_line cl
        WHERE cl.contract_id = v_contract_id
          AND cl.code = v_code
          AND cl.deleted_at IS NULL
        ON DUPLICATE KEY UPDATE
          deleted_at = NULL,
          updated_by = VALUES(updated_by),
          updated_at = CURRENT_TIMESTAMP;
      END IF;
      SET v_index = v_index + 1;
    END WHILE;
  END LOOP;
  CLOSE cur;
END$$

CREATE PROCEDURE hzy_034_backfill_contract_project_obligation_codes()
BEGIN
  DECLARE done INT DEFAULT 0;
  DECLARE v_link_id BIGINT;
  DECLARE v_contract_id BIGINT;
  DECLARE v_json JSON;
  DECLARE v_index INT DEFAULT 0;
  DECLARE v_count INT DEFAULT 0;
  DECLARE v_code VARCHAR(100);

  DECLARE cur CURSOR FOR
    SELECT id, contract_id, obligation_codes_json
    FROM contract_project_link
    WHERE deleted_at IS NULL
      AND obligation_codes_json IS NOT NULL
      AND JSON_VALID(obligation_codes_json);
  DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = 1;

  OPEN cur;
  read_loop: LOOP
    FETCH cur INTO v_link_id, v_contract_id, v_json;
    IF done = 1 THEN
      LEAVE read_loop;
    END IF;

    SET v_index = 0;
    SET v_count = COALESCE(JSON_LENGTH(v_json), 0);
    WHILE v_index < v_count DO
      SET v_code = TRIM(BOTH '"' FROM JSON_UNQUOTE(JSON_EXTRACT(v_json, CONCAT('$[', v_index, ']'))));
      IF v_code IS NOT NULL AND v_code <> '' THEN
        INSERT INTO contract_project_obligation_rel (
          contract_project_link_id,
          obligation_id,
          created_by,
          updated_by
        )
        SELECT
          v_link_id,
          ob.id,
          'migration_034',
          'migration_034'
        FROM contract_obligation ob
        WHERE ob.contract_id = v_contract_id
          AND ob.code = v_code
          AND ob.deleted_at IS NULL
        ON DUPLICATE KEY UPDATE
          deleted_at = NULL,
          updated_by = VALUES(updated_by),
          updated_at = CURRENT_TIMESTAMP;
      END IF;
      SET v_index = v_index + 1;
    END WHILE;
  END LOOP;
  CLOSE cur;
END$$

DELIMITER ;

-- Direct legacy foreign keys.
INSERT INTO contract_project_line_rel (
  contract_project_link_id,
  contract_line_id,
  relation_type,
  allocation_method,
  created_by,
  updated_by
)
SELECT
  cpl.id,
  cpl.contract_line_id,
  CASE
    WHEN cpl.project_role IN ('development', 'customization') THEN 'customization'
    WHEN cpl.project_role = 'training' THEN 'training'
    WHEN cpl.project_role = 'warranty' THEN 'warranty'
    WHEN cpl.project_role IN ('maintenance', 'operation') THEN 'maintenance'
    WHEN cpl.project_role = 'change' THEN 'change'
    WHEN cpl.project_role IN ('primary', 'delivery', 'implementation') THEN 'delivery'
    ELSE 'other'
  END,
  'unallocated',
  'migration_034',
  'migration_034'
FROM contract_project_link cpl
INNER JOIN contract_line cl ON cl.id = cpl.contract_line_id
WHERE cpl.deleted_at IS NULL
  AND cl.deleted_at IS NULL
  AND cl.contract_id = cpl.contract_id
  AND cpl.contract_line_id IS NOT NULL
ON DUPLICATE KEY UPDATE
  deleted_at = NULL,
  updated_by = VALUES(updated_by),
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO contract_project_obligation_rel (
  contract_project_link_id,
  obligation_id,
  created_by,
  updated_by
)
SELECT
  cpl.id,
  cpl.obligation_id,
  'migration_034',
  'migration_034'
FROM contract_project_link cpl
INNER JOIN contract_obligation ob ON ob.id = cpl.obligation_id
WHERE cpl.deleted_at IS NULL
  AND ob.deleted_at IS NULL
  AND ob.contract_id = cpl.contract_id
  AND cpl.obligation_id IS NOT NULL
ON DUPLICATE KEY UPDATE
  deleted_at = NULL,
  updated_by = VALUES(updated_by),
  updated_at = CURRENT_TIMESTAMP;

CALL hzy_034_backfill_contract_project_line_codes();
CALL hzy_034_backfill_contract_project_obligation_codes();

-- Planned/active service agreements that were created from maintenance lines
-- get a default maintenance project when the contract already has exactly one
-- active maintenance project link.
INSERT INTO service_agreement_project_rel (
  service_agreement_id,
  project_code,
  project_role,
  is_default,
  effective_from,
  effective_to,
  status,
  source_type,
  created_by,
  updated_by
)
SELECT
  sa.id,
  MIN(cpl.project_code) AS project_code,
  'maintenance',
  1,
  sa.service_start_date,
  sa.service_end_date,
  CASE WHEN sa.status = 'active' THEN 'active' ELSE 'planned' END,
  'migration',
  'migration_034',
  'migration_034'
FROM service_agreement sa
INNER JOIN contract_project_link cpl
  ON cpl.contract_id = sa.contract_id
  AND cpl.deleted_at IS NULL
  AND cpl.status IN ('planned', 'active')
  AND cpl.project_role IN ('maintenance', 'operation')
WHERE sa.deleted_at IS NULL
  AND sa.status IN ('planned', 'active')
GROUP BY
  sa.id,
  sa.service_start_date,
  sa.service_end_date,
  sa.status
HAVING COUNT(DISTINCT cpl.project_code) = 1
ON DUPLICATE KEY UPDATE
  is_default = VALUES(is_default),
  effective_from = COALESCE(VALUES(effective_from), effective_from),
  effective_to = COALESCE(VALUES(effective_to), effective_to),
  status = VALUES(status),
  source_type = VALUES(source_type),
  deleted_at = NULL,
  updated_by = VALUES(updated_by),
  updated_at = CURRENT_TIMESTAMP;

SELECT
  (SELECT COUNT(*) FROM contract_project_link WHERE deleted_at IS NULL) AS link_total,
  (SELECT COUNT(*)
   FROM contract_project_link
   WHERE deleted_at IS NULL
     AND contract_line_id IS NOT NULL) AS direct_line_relation_count,
  (SELECT COALESCE(SUM(JSON_LENGTH(line_codes_json)), 0)
   FROM contract_project_link
   WHERE deleted_at IS NULL
     AND line_codes_json IS NOT NULL
     AND JSON_VALID(line_codes_json)) AS parseable_line_json_relation_count,
  (SELECT COUNT(*) FROM contract_project_line_rel WHERE deleted_at IS NULL) AS line_backfilled_count,
  (SELECT COUNT(*)
   FROM contract_project_link
   WHERE deleted_at IS NULL
     AND obligation_id IS NOT NULL) AS direct_obligation_relation_count,
  (SELECT COALESCE(SUM(JSON_LENGTH(obligation_codes_json)), 0)
   FROM contract_project_link
   WHERE deleted_at IS NULL
     AND obligation_codes_json IS NOT NULL
     AND JSON_VALID(obligation_codes_json)) AS parseable_obligation_json_relation_count,
  (SELECT COUNT(*) FROM contract_project_obligation_rel WHERE deleted_at IS NULL) AS obligation_backfilled_count,
  (SELECT COUNT(*)
   FROM contract_project_link
   WHERE deleted_at IS NULL
     AND ((line_codes_json IS NOT NULL AND NOT JSON_VALID(line_codes_json))
       OR (obligation_codes_json IS NOT NULL AND NOT JSON_VALID(obligation_codes_json)))) AS invalid_json_link_count,
  (SELECT COUNT(*)
   FROM contract_project_link cpl
   JOIN (
     SELECT ones.n + tens.n * 10 + hundreds.n * 100 AS n
     FROM (
       SELECT 0 AS n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4
       UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9
     ) ones
     CROSS JOIN (
       SELECT 0 AS n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4
       UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9
     ) tens
     CROSS JOIN (
       SELECT 0 AS n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4
       UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9
     ) hundreds
   ) seq ON seq.n < JSON_LENGTH(cpl.line_codes_json)
   WHERE cpl.deleted_at IS NULL
     AND cpl.line_codes_json IS NOT NULL
     AND JSON_VALID(cpl.line_codes_json)
     AND TRIM(JSON_UNQUOTE(JSON_EXTRACT(cpl.line_codes_json, CONCAT('$[', seq.n, ']')))) <> ''
     AND NOT EXISTS (
       SELECT 1
       FROM contract_line cl
       WHERE cl.contract_id = cpl.contract_id
         AND cl.code = JSON_UNQUOTE(JSON_EXTRACT(cpl.line_codes_json, CONCAT('$[', seq.n, ']')))
         AND cl.deleted_at IS NULL
     )) AS unmatched_line_code_count,
  (SELECT COUNT(*)
   FROM contract_project_link cpl
   JOIN (
     SELECT ones.n + tens.n * 10 + hundreds.n * 100 AS n
     FROM (
       SELECT 0 AS n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4
       UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9
     ) ones
     CROSS JOIN (
       SELECT 0 AS n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4
       UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9
     ) tens
     CROSS JOIN (
       SELECT 0 AS n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4
       UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9
     ) hundreds
   ) seq ON seq.n < JSON_LENGTH(cpl.obligation_codes_json)
   WHERE cpl.deleted_at IS NULL
     AND cpl.obligation_codes_json IS NOT NULL
     AND JSON_VALID(cpl.obligation_codes_json)
     AND TRIM(JSON_UNQUOTE(JSON_EXTRACT(cpl.obligation_codes_json, CONCAT('$[', seq.n, ']')))) <> ''
     AND NOT EXISTS (
       SELECT 1
       FROM contract_obligation ob
       WHERE ob.contract_id = cpl.contract_id
         AND ob.code = JSON_UNQUOTE(JSON_EXTRACT(cpl.obligation_codes_json, CONCAT('$[', seq.n, ']')))
         AND ob.deleted_at IS NULL
     )) AS unmatched_obligation_code_count,
  (SELECT COUNT(*)
   FROM (
     SELECT contract_project_link_id, contract_line_id, relation_type
     FROM contract_project_line_rel
     WHERE deleted_at IS NULL
     GROUP BY contract_project_link_id, contract_line_id, relation_type
     HAVING COUNT(*) > 1
   ) duplicate_line_rels) AS duplicate_line_relation_count,
  (SELECT COUNT(*)
   FROM (
     SELECT contract_project_link_id, obligation_id
     FROM contract_project_obligation_rel
     WHERE deleted_at IS NULL
     GROUP BY contract_project_link_id, obligation_id
     HAVING COUNT(*) > 1
   ) duplicate_obligation_rels) AS duplicate_obligation_relation_count,
  (SELECT COUNT(*)
   FROM contract_project_line_rel rel
   LEFT JOIN contract_project_link cpl ON cpl.id = rel.contract_project_link_id AND cpl.deleted_at IS NULL
   LEFT JOIN contract_line cl ON cl.id = rel.contract_line_id AND cl.deleted_at IS NULL
   WHERE rel.deleted_at IS NULL
     AND (cpl.id IS NULL OR cl.id IS NULL OR cl.contract_id <> cpl.contract_id)) AS orphan_line_relation_count,
  (SELECT COUNT(*)
   FROM contract_project_obligation_rel rel
   LEFT JOIN contract_project_link cpl ON cpl.id = rel.contract_project_link_id AND cpl.deleted_at IS NULL
   LEFT JOIN contract_obligation ob ON ob.id = rel.obligation_id AND ob.deleted_at IS NULL
   WHERE rel.deleted_at IS NULL
     AND (cpl.id IS NULL OR ob.id IS NULL OR ob.contract_id <> cpl.contract_id)) AS orphan_obligation_relation_count,
  (SELECT COUNT(*)
   FROM service_agreement_project_rel
   WHERE deleted_at IS NULL) AS service_agreement_project_relation_count;

DROP PROCEDURE hzy_034_backfill_contract_project_obligation_codes;
DROP PROCEDURE hzy_034_backfill_contract_project_line_codes;
