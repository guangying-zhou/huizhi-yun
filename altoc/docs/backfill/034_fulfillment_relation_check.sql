-- 034 fulfillment relation backfill verification.
-- Run after migration 034 in the target Altoc tenant database.

SELECT COUNT(*) AS link_total
FROM contract_project_link
WHERE deleted_at IS NULL;

SELECT
  COALESCE(SUM(CASE WHEN line_codes_json IS NOT NULL AND JSON_VALID(line_codes_json) THEN JSON_LENGTH(line_codes_json) ELSE 0 END), 0) AS parseable_line_json_relation_count,
  COALESCE(SUM(CASE WHEN obligation_codes_json IS NOT NULL AND JSON_VALID(obligation_codes_json) THEN JSON_LENGTH(obligation_codes_json) ELSE 0 END), 0) AS parseable_obligation_json_relation_count,
  SUM(CASE WHEN line_codes_json IS NOT NULL AND NOT JSON_VALID(line_codes_json) THEN 1 ELSE 0 END) AS invalid_line_json_link_count,
  SUM(CASE WHEN obligation_codes_json IS NOT NULL AND NOT JSON_VALID(obligation_codes_json) THEN 1 ELSE 0 END) AS invalid_obligation_json_link_count
FROM contract_project_link
WHERE deleted_at IS NULL;

SELECT COUNT(*) AS line_relation_success_count
FROM contract_project_line_rel
WHERE deleted_at IS NULL;

SELECT COUNT(*) AS obligation_relation_success_count
FROM contract_project_obligation_rel
WHERE deleted_at IS NULL;

SELECT COUNT(*) AS unmatched_line_code_count
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
  );

SELECT COUNT(*) AS unmatched_obligation_code_count
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
  );

SELECT COUNT(*) AS duplicate_line_relation_count
FROM (
  SELECT contract_project_link_id, contract_line_id, relation_type, COUNT(*) AS cnt
  FROM contract_project_line_rel
  WHERE deleted_at IS NULL
  GROUP BY contract_project_link_id, contract_line_id, relation_type
  HAVING COUNT(*) > 1
) duplicates;

SELECT COUNT(*) AS duplicate_obligation_relation_count
FROM (
  SELECT contract_project_link_id, obligation_id, COUNT(*) AS cnt
  FROM contract_project_obligation_rel
  WHERE deleted_at IS NULL
  GROUP BY contract_project_link_id, obligation_id
  HAVING COUNT(*) > 1
) duplicates;

SELECT COUNT(*) AS orphan_line_relation_count
FROM contract_project_line_rel rel
LEFT JOIN contract_project_link cpl ON cpl.id = rel.contract_project_link_id AND cpl.deleted_at IS NULL
LEFT JOIN contract_line cl ON cl.id = rel.contract_line_id AND cl.deleted_at IS NULL
WHERE rel.deleted_at IS NULL
  AND (cpl.id IS NULL OR cl.id IS NULL OR cl.contract_id <> cpl.contract_id);

SELECT COUNT(*) AS orphan_obligation_relation_count
FROM contract_project_obligation_rel rel
LEFT JOIN contract_project_link cpl ON cpl.id = rel.contract_project_link_id AND cpl.deleted_at IS NULL
LEFT JOIN contract_obligation ob ON ob.id = rel.obligation_id AND ob.deleted_at IS NULL
WHERE rel.deleted_at IS NULL
  AND (cpl.id IS NULL OR ob.id IS NULL OR ob.contract_id <> cpl.contract_id);

SELECT
  service_agreement_id,
  COUNT(*) AS active_default_count
FROM service_agreement_project_rel
WHERE deleted_at IS NULL
  AND is_default = 1
  AND status = 'active'
  AND (effective_from IS NULL OR effective_from <= CURRENT_DATE)
  AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)
GROUP BY service_agreement_id
HAVING COUNT(*) > 1;
