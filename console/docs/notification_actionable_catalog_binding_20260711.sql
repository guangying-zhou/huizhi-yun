-- G4-2: catalog URL binding is a publish-time security proof, not a route
-- reconstruction exercise. New pending actionables carry the Console-written
-- metadata.actionTargetCatalogBinding = 'catalog-v1' marker only after their
-- URL and target application have been resolved against the signed catalog.
--
-- Historical pending projections have no durable proof that their action_url
-- was catalog-bound. Do not infer a target from source_app_code, action_url or
-- a former runtime base URL. This repeatable, fail-closed migration cancels
-- only the unprovable pending projections; immutable notification/recipient
-- facts are intentionally not rewritten. It is a release prerequisite and
-- MUST be run through the approved tenant migration procedure, never at app
-- startup or during Cloudflare deployment.

UPDATE `portal_actionable_projections` p
INNER JOIN `portal_notifications` n
  ON n.`notification_id` = p.`current_notification_id`
SET p.`state` = 'cancelled',
    p.`closed_at` = COALESCE(p.`closed_at`, UTC_TIMESTAMP()),
    p.`updated_at` = UTC_TIMESTAMP()
WHERE p.`state` = 'pending'
  -- COALESCE catches missing, JSON null and non-scalar values as unproven.
  AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(n.`metadata_json`, '$.actionTargetCatalogBinding')), '') <> 'catalog-v1';
