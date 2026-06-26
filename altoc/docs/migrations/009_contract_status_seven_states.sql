-- Normalize contract.status to the seven canonical lifecycle states.
-- Canonical states:
-- draft / pending_approval / approved / effective / completed / terminated / invalid

UPDATE contract
SET effective_date = CASE
        WHEN status IN ('executing', 'delivering', 'accepted', 'service_ended', 'expired')
            THEN COALESCE(effective_date, sign_date)
        ELSE effective_date
    END,
    status = CASE
        WHEN status = 'rejected' THEN 'draft'
        WHEN status IN ('executing', 'delivering', 'accepted', 'service_ended', 'expired') THEN 'effective'
        ELSE status
    END,
    updated_at = NOW()
WHERE deleted_at IS NULL
  AND status IN ('rejected', 'executing', 'delivering', 'accepted', 'service_ended', 'expired');
