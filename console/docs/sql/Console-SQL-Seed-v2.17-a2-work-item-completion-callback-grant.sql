-- Local C000001 A2 only. Back up service_client_grants before applying.
-- Physical resource code is unprefixed for the data-runtime audience.
-- Insert missing only; an existing inactive or mismatched row must be reviewed.
START TRANSACTION;
INSERT INTO service_client_grants(service_client_id,resource_code,action,scope_json,status,created_at,updated_at)
SELECT sc.id,'aims:work-item-completion-callback','execute',
 JSON_OBJECT('source','seed:round3-a2-work-item-completion-callback',
             'audience','data-runtime',
             'semanticScope','aims:work-item-completion-callback:execute',
             'tenantCode','C000001',
             'deploymentCode','C000001-test-aims'),
 'active',UTC_TIMESTAMP(),UTC_TIMESTAMP()
FROM service_clients sc
WHERE sc.client_code='aims.runtime' AND sc.app_code='aims' AND sc.status='active'
 AND NOT EXISTS (
  SELECT 1 FROM service_client_grants existing
  WHERE existing.service_client_id=sc.id
    AND existing.resource_code='aims:work-item-completion-callback'
    AND existing.action='execute'
 );
COMMIT;
