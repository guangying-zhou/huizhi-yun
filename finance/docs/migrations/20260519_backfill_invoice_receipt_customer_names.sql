-- Backfill Finance invoice and receipt customer snapshots from legacy OA.
-- Run in hzy_finance. The legacy source database is expected to be wizbizdb.

UPDATE finance_invoice fi
JOIN wizbizdb.wb_invoice wi ON wi.invoice_id = fi.legacy_id
LEFT JOIN wizbizdb.wb_contract wc ON wc.contract_id = wi.contract_id
LEFT JOIN wizbizdb.wb_project wip ON wip.project_id = wi.project_id
LEFT JOIN wizbizdb.wb_project wcp ON wcp.project_id = wc.project_id
LEFT JOIN wizbizdb.wb_project wcip ON wcip.project_id = wc.impl_project_id
LEFT JOIN wizbizdb.wb_organization wo
    ON wo.org_id = COALESCE(NULLIF(wc.customer_id, 0), NULLIF(wip.org_id, 0), NULLIF(wcp.org_id, 0), NULLIF(wcip.org_id, 0))
SET
    fi.customer_code = CASE
        WHEN COALESCE(NULLIF(wc.customer_id, 0), NULLIF(wip.org_id, 0), NULLIF(wcp.org_id, 0), NULLIF(wcip.org_id, 0)) IS NULL THEN fi.customer_code
        ELSE CONCAT('CUMIG', COALESCE(NULLIF(wc.customer_id, 0), NULLIF(wip.org_id, 0), NULLIF(wcp.org_id, 0), NULLIF(wcip.org_id, 0)))
    END,
    fi.customer_name = COALESCE(NULLIF(TRIM(wo.org_name), ''), fi.customer_name)
WHERE fi.legacy_source = 'wizbizdb'
  AND fi.legacy_id IS NOT NULL
  AND (
      fi.customer_name IS NULL
      OR fi.customer_name = ''
      OR fi.customer_code IS NULL
      OR fi.customer_code = ''
      OR fi.customer_code <> CONCAT('CUMIG', COALESCE(NULLIF(wc.customer_id, 0), NULLIF(wip.org_id, 0), NULLIF(wcp.org_id, 0), NULLIF(wcip.org_id, 0)))
      OR BINARY fi.customer_name <> BINARY TRIM(wo.org_name)
  );

UPDATE finance_receipt fr
JOIN wizbizdb.wb_project_income wpi ON wpi.pi_id = fr.legacy_id
LEFT JOIN wizbizdb.wb_contract wc ON wc.contract_id = wpi.contract_id
LEFT JOIN wizbizdb.wb_project wrp ON wrp.project_id = wpi.project_id
LEFT JOIN wizbizdb.wb_project wcp ON wcp.project_id = wc.project_id
LEFT JOIN wizbizdb.wb_project wcip ON wcip.project_id = wc.impl_project_id
LEFT JOIN wizbizdb.wb_organization wo
    ON wo.org_id = COALESCE(NULLIF(wc.customer_id, 0), NULLIF(wrp.org_id, 0), NULLIF(wcp.org_id, 0), NULLIF(wcip.org_id, 0))
SET
    fr.customer_code = CASE
        WHEN COALESCE(NULLIF(wc.customer_id, 0), NULLIF(wrp.org_id, 0), NULLIF(wcp.org_id, 0), NULLIF(wcip.org_id, 0)) IS NULL THEN fr.customer_code
        ELSE CONCAT('CUMIG', COALESCE(NULLIF(wc.customer_id, 0), NULLIF(wrp.org_id, 0), NULLIF(wcp.org_id, 0), NULLIF(wcip.org_id, 0)))
    END,
    fr.customer_name = COALESCE(NULLIF(TRIM(wo.org_name), ''), fr.customer_name)
WHERE fr.legacy_source = 'wizbizdb'
  AND fr.legacy_id IS NOT NULL
  AND (
      fr.customer_name IS NULL
      OR fr.customer_name = ''
      OR fr.customer_code IS NULL
      OR fr.customer_code = ''
      OR fr.customer_code <> CONCAT('CUMIG', COALESCE(NULLIF(wc.customer_id, 0), NULLIF(wrp.org_id, 0), NULLIF(wcp.org_id, 0), NULLIF(wcip.org_id, 0)))
      OR BINARY fr.customer_name <> BINARY TRIM(wo.org_name)
  );

UPDATE finance_unclassified_income fui
JOIN wizbizdb.wb_project_income wpi ON wpi.pi_id = fui.legacy_id
LEFT JOIN wizbizdb.wb_project wp ON wp.project_id = wpi.project_id
LEFT JOIN wizbizdb.wb_organization wo ON wo.org_id = NULLIF(wp.org_id, 0)
SET
    fui.customer_code = CASE
        WHEN NULLIF(wp.org_id, 0) IS NULL THEN fui.customer_code
        ELSE CONCAT('CUMIG', wp.org_id)
    END,
    fui.customer_name = COALESCE(NULLIF(TRIM(wo.org_name), ''), fui.customer_name)
WHERE fui.legacy_source = 'wizbizdb'
  AND fui.legacy_id IS NOT NULL
  AND (
      fui.customer_name IS NULL
      OR fui.customer_name = ''
      OR fui.customer_code IS NULL
      OR fui.customer_code = ''
      OR fui.customer_code <> CONCAT('CUMIG', wp.org_id)
      OR BINARY fui.customer_name <> BINARY TRIM(wo.org_name)
  );
