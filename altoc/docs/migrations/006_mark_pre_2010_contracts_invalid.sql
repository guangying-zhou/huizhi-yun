-- Mark legacy contracts signed before 2010 as invalid.
-- Invalid contracts remain queryable by explicit status filter, but are excluded
-- from default contract list summaries and dashboard statistics.

UPDATE contract
SET status = 'invalid',
    last_status_changed_at = COALESCE(last_status_changed_at, NOW()),
    updated_at = NOW()
WHERE deleted_at IS NULL
  AND sign_date IS NOT NULL
  AND sign_date < '2010-01-01'
  AND (status IS NULL OR status <> 'invalid');
