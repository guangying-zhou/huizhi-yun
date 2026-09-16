-- v2.30: stop treating Console Directory projects as Platform jobs.
-- Safe to run before or after the corrected project projection is synchronized.

START TRANSACTION;

UPDATE tenant_subjects legacy_job
SET legacy_job.status = 'disabled',
    legacy_job.updated_at = NOW()
WHERE legacy_job.subject_type = 'job'
  AND legacy_job.external_ref = SHA2(CONCAT('console:project:', legacy_job.subject_code), 256)
  AND legacy_job.status <> 'disabled';

UPDATE tenant_subject_memberships membership
INNER JOIN tenant_subjects legacy_job
  ON legacy_job.id = membership.container_subject_id
 AND legacy_job.tenant_code = membership.tenant_code
SET membership.status = 'inactive',
    membership.updated_at = NOW()
WHERE membership.source = 'runtime'
  AND legacy_job.subject_type = 'job'
  AND legacy_job.external_ref = SHA2(CONCAT('console:project:', legacy_job.subject_code), 256)
  AND membership.status <> 'inactive';

COMMIT;
