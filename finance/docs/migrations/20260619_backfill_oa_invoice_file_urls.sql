-- Backfill Finance invoice file URLs from legacy OA invoice archive pages.
-- Run in hzy_finance after 20260619_invoice_medium_and_files.sql.
-- Source database is expected to be wizbizdb on the same MySQL instance.
--
-- This does not copy files. It stores the original OA archive URL so Finance/Altoc
-- can preview historical invoice PDFs/OFDs/images from finance_invoice.invoice_file_url.

USE hzy_finance;

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
SET collation_connection = 'utf8mb4_unicode_ci';

DROP TEMPORARY TABLE IF EXISTS tmp_oa_invoice_files;

CREATE TEMPORARY TABLE tmp_oa_invoice_files (
  invoice_id BIGINT NOT NULL,
  invoice_code VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  ap_id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  file_url VARCHAR(1000) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  file_name VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  mime_type VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (invoice_id),
  UNIQUE KEY uk_tmp_oa_invoice_files_code (invoice_code)
) ENGINE=Memory;

INSERT INTO tmp_oa_invoice_files (
  invoice_id,
  invoice_code,
  ap_id,
  file_url,
  file_name,
  mime_type
)
SELECT
  wi.invoice_id,
  TRIM(wi.invoice_code) COLLATE utf8mb4_unicode_ci AS invoice_code,
  p.ap_id COLLATE utf8mb4_unicode_ci AS ap_id,
  TRIM(p.ap_url) COLLATE utf8mb4_unicode_ci AS file_url,
  (CASE
    WHEN LOWER(TRIM(p.ap_url)) LIKE '%.ofd%' THEN CONCAT(COALESCE(NULLIF(TRIM(p.ap_name), ''), TRIM(wi.invoice_code)), '.ofd')
    WHEN LOWER(TRIM(p.ap_url)) LIKE '%.pdf%' THEN CONCAT(COALESCE(NULLIF(TRIM(p.ap_name), ''), TRIM(wi.invoice_code)), '.pdf')
    WHEN LOWER(TRIM(p.ap_url)) LIKE '%.jpeg%' THEN CONCAT(COALESCE(NULLIF(TRIM(p.ap_name), ''), TRIM(wi.invoice_code)), '.jpeg')
    WHEN LOWER(TRIM(p.ap_url)) LIKE '%.jpg%' THEN CONCAT(COALESCE(NULLIF(TRIM(p.ap_name), ''), TRIM(wi.invoice_code)), '.jpg')
    WHEN LOWER(TRIM(p.ap_url)) LIKE '%.png%' THEN CONCAT(COALESCE(NULLIF(TRIM(p.ap_name), ''), TRIM(wi.invoice_code)), '.png')
    ELSE SUBSTRING_INDEX(SUBSTRING_INDEX(TRIM(p.ap_url), '?', 1), '/', -1)
  END) COLLATE utf8mb4_unicode_ci AS file_name,
  (CASE
    WHEN LOWER(TRIM(p.ap_url)) LIKE '%.ofd%' THEN 'application/ofd'
    WHEN LOWER(TRIM(p.ap_url)) LIKE '%.pdf%' THEN 'application/pdf'
    WHEN LOWER(TRIM(p.ap_url)) LIKE '%.jpeg%' THEN 'image/jpeg'
    WHEN LOWER(TRIM(p.ap_url)) LIKE '%.jpg%' THEN 'image/jpeg'
    WHEN LOWER(TRIM(p.ap_url)) LIKE '%.png%' THEN 'image/png'
    ELSE NULL
  END) COLLATE utf8mb4_unicode_ci AS mime_type
FROM wizbizdb.wb_invoice wi
INNER JOIN wizbizdb.wb_archives_page p
  ON p.ap_id COLLATE utf8mb4_unicode_ci = wi.ap_id COLLATE utf8mb4_unicode_ci
WHERE wi.ap_id IS NOT NULL
  AND TRIM(wi.ap_id) <> ''
  AND p.ap_url IS NOT NULL
  AND TRIM(p.ap_url) <> ''
  AND COALESCE(p.ap_status, '0') <> '1'
  AND (
    LOWER(TRIM(p.ap_url)) LIKE '%.pdf%'
    OR LOWER(TRIM(p.ap_url)) LIKE '%.ofd%'
    OR LOWER(TRIM(p.ap_url)) LIKE '%.jpeg%'
    OR LOWER(TRIM(p.ap_url)) LIKE '%.jpg%'
    OR LOWER(TRIM(p.ap_url)) LIKE '%.png%'
  );

SELECT COUNT(*) AS oa_invoice_file_candidates
FROM tmp_oa_invoice_files;

UPDATE finance_invoice fi
INNER JOIN tmp_oa_invoice_files src
  ON (
    fi.legacy_source COLLATE utf8mb4_unicode_ci = 'wizbizdb' COLLATE utf8mb4_unicode_ci
    AND fi.legacy_id = src.invoice_id
  )
  OR (
    fi.invoice_no IS NOT NULL
    AND fi.invoice_no COLLATE utf8mb4_unicode_ci = src.invoice_code COLLATE utf8mb4_unicode_ci
  )
SET
  fi.invoice_medium = COALESCE(NULLIF(fi.invoice_medium, ''), 'electronic'),
  fi.invoice_file_url = src.file_url,
  fi.invoice_file_name = src.file_name,
  fi.invoice_file_mime_type = src.mime_type,
  fi.invoice_file_size = NULL,
  fi.source_refs_json = JSON_SET(
    COALESCE(fi.source_refs_json, JSON_OBJECT()),
    '$.oa_invoice_ap_id',
    src.ap_id,
    '$.oa_invoice_file_url',
    src.file_url
  ),
  fi.updated_at = CURRENT_TIMESTAMP
WHERE fi.deleted_at IS NULL
  AND (fi.invoice_file_url IS NULL OR TRIM(fi.invoice_file_url) = '');

SELECT ROW_COUNT() AS backfilled_finance_invoice_files;

SELECT COUNT(*) AS finance_invoices_with_file_url
FROM finance_invoice
WHERE deleted_at IS NULL
  AND invoice_file_url IS NOT NULL
  AND TRIM(invoice_file_url) <> '';

DROP TEMPORARY TABLE IF EXISTS tmp_oa_invoice_files;
