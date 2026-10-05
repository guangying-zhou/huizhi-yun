-- READ-ONLY CANDIDATE. No name-based retirement or automatic old stable fan-out.
SELECT c.*,r.release_version,r.release_signing_key_id FROM platform_runtime_release_channels c
JOIN platform_runtime_releases r ON r.id=c.approved_release_id
WHERE c.runtime_code='hzy-data-runtime' ORDER BY c.channel_code;
SELECT id,runtime_code,tenant_code,environment,status,release_update_mode,
 current_version,desired_version,release_signing_key_id
FROM tenant_runtime_instances ORDER BY id;
-- Review exact old stable provenance and approved environment, key and version.
-- Later operator-owned transaction shape (not executable automatic migration):
-- INSERT INTO platform_runtime_release_channels
-- (runtime_code,channel_code,approved_release_id,approval_kind,approved_by_account_id,approved_at,approval_note)
-- SELECT runtime_code,'stable-<reviewed environment>',approved_release_id,approval_kind,
-- approved_by_account_id,approved_at,approval_note FROM platform_runtime_release_channels
-- WHERE runtime_code='hzy-data-runtime' AND channel_code='stable';
-- Assert affected rows=1, channel absent before, exact release ID/hash match.
-- UPDATE tenant_runtime_instances SET release_update_mode='tracking'
-- WHERE id=<approved id> AND runtime_code='<approved code>' AND environment='<reviewed env>'
-- AND release_update_mode='pinned' AND desired_version='<unchanged exact version>';
-- Japanese retired transition requires its own exact identity/host approval;
-- if identity is reused by current prod, STOP, do not retire that row.
