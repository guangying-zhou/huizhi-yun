import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = new URL('../../', import.meta.url)
const manifests = Object.fromEntries(['aims', 'assets', 'codocs', 'altoc', 'finance'].map(app => [app, JSON.parse(readFileSync(new URL(`${app}/app.manifest.json`, root), 'utf8'))]))
const rows = []
function add(app, audience, resource, action, install = true) {
  const target = resource.split(':')[0]
  const code = resource.slice(target.length + 1)
  if (install && manifests[target] && !manifests[target].resources.some(row => row.code === code && row.actions.includes(action))) throw new Error(`Undeclared capability: ${resource}:${action}`)
  rows.push({ app, audience, resource: ['data-runtime', 'tenant-runtime'].includes(audience) ? `${audience}:${resource}` : resource, action, install })
}
// Exact product capabilities only. Adoption grants are prepared alongside its
// implementation; generating these artifacts does not enable a service route.
for (const audience of ['data-runtime', 'tenant-runtime']) {
  add('altoc', audience, 'altoc:integration_operation', 'execute')
  add('altoc', audience, 'altoc:product-feedback', 'update-status')
  add('altoc', audience, 'altoc:product-feedback', 'update-progress')
  add('altoc', audience, 'altoc:service_ticket', 'edit')
  for (const action of ['read', 'write']) rows.push({ app: 'altoc', audience, resource: `${audience}:altoc`, action, install: false })
  add('aims', audience, 'aims:integration_operation', 'execute')
  add('aims', audience, 'aims:product-version-summary', 'read')
  for (const action of ['freeze', 'status']) add('aims', audience, 'aims:product-cost-rules', action)
  add('aims', audience, 'aims:product-request', 'create-from-feedback')
  for (const action of ['authorization-object', 'view', 'edit', 'onboard', 'archive', 'restore', 'admin']) add('aims', audience, 'aims:products', action)
  for (const action of ['create', 'read', 'edit', 'scope-create', 'scope-edit', 'scope-deliver', 'scope-reopen', 'scope-visibility', 'scope-legacy-criteria', 'accept', 'publish', 'reopen', 'archive', 'delete']) add('aims', audience, 'aims:product-versions', action)
  for (const action of ['read', 'create', 'edit', 'item-link', 'cycle-map', 'cycle-revoke', 'observe', 'activate', 'close', 'reopen', 'archive']) add('aims', audience, 'aims:product-objectives', action)
  for (const action of ['read', 'window-edit', 'commit', 'view-create', 'view-update', 'view-delete']) add('aims', audience, 'aims:product-roadmaps', action)
  for (const action of ['read', 'create', 'move', 'edit', 'delete']) add('aims', audience, 'aims:product-components', action)
  for (const action of ['create', 'read', 'edit', 'delete', 'request-link', 'lifecycle', 'component-assign']) add('aims', audience, 'aims:product-features', action)
  for (const action of ['create', 'read', 'edit', 'decide', 'source-create', 'source-delete', 'merge']) add('aims', audience, 'aims:product-requests', action)
  for (const action of ['create', 'read', 'edit', 'cycle-open', 'cycle-close', 'cycle-review', 'budget-change', 'withdraw', 'consumption-confirm', 'comment', 'observe', 'assess', 'move', 'select', 'feature-link', 'model-create', 'reach-record', 'rice-assess', 'cycle-model-select', 'cross-dependency-create', 'cross-dependency-remove', 'project-authorization', 'handoff']) add('aims', audience, 'aims:product-priorities', action)
  add('assets', audience, 'assets:product', 'read')
  add('assets', audience, 'assets:product-adoption', 'read')
  add('finance', audience, 'finance:product-cost', 'read')
  add('finance', audience, 'finance:product-cost', 'replace-rules')
  add('finance', audience, 'finance:product-cost', 'read-rules')
  for (const action of ['read', 'write']) rows.push({ app: 'finance', audience, resource: `${audience}:finance`, action, install: false })
  for (const action of ['read', 'remove', 'edit', 'restore', 'create']) add('aims', audience, 'aims:product-documents', action)
  for (const action of ['read', 'create']) add('codocs', audience, 'codocs:product-document', action)
  for (const action of ['read', 'write']) rows.push({ app: 'codocs', audience, resource: `${audience}:codocs`, action, install: false })
  // Existing transport capabilities are prerequisites, never silently widened.
  for (const action of ['read', 'write']) rows.push({ app: 'aims', audience, resource: `${audience}:aims`, action, install: false })
  rows.push({ app: 'assets', audience, resource: `${audience}:assets`, action: 'read', install: false })
}
add('altoc', 'aims', 'aims:product-request', 'create-from-feedback')
add('aims', 'altoc', 'altoc:product-feedback', 'update-status')
add('aims', 'altoc', 'altoc:product-feedback', 'update-progress')
add('assets', 'aims', 'aims:product-version-summary', 'read')
add('assets', 'codocs', 'codocs:product-document', 'read')
add('aims', 'assets', 'assets:product', 'read')
add('aims', 'assets', 'assets:product-adoption', 'read')
add('aims', 'finance', 'finance:product-cost', 'read')
add('aims', 'finance', 'finance:product-cost', 'replace-rules')
add('aims', 'finance', 'finance:product-cost', 'read-rules')
for (const action of ['read', 'create']) add('aims', 'codocs', 'codocs:product-document', action)
add('aims', 'console', 'console:directory-users', 'read')
const consoleManifest = JSON.parse(readFileSync(new URL('console/app.manifest.json', root), 'utf8'))
if (!consoleManifest.resources.some(row => row.code === 'subject-authorization' && row.actions.includes('read'))) throw new Error('Undeclared Console subject authorization capability')
for (const app of ['aims', 'assets', 'finance']) add(app, 'console', 'console:subject-authorization', 'read')
const quote = value => `'${value.replaceAll('\'', '\'\'')}'`
const matrix = rows.map(row => `SELECT ${quote(row.app)} app_code, ${quote(row.audience)} audience, ${quote(row.resource)} resource_code, ${quote(row.action)} action, ${row.install ? 1 : 0} install_grant`).join('\nUNION ALL\n')
const header = `-- Generated by aims/scripts/generate-product-center-grants.mjs; edit the generator, not this file.
-- Run only against the intended Console tenant database. This file does not access secrets.
-- Set @pc_aims_client_code / @pc_assets_client_code / @pc_codocs_client_code / @pc_altoc_client_code / @pc_finance_client_code to the actual enrolled client codes before execution.
-- Defaults select exact runtime clients, never every client sharing an app_code.
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
SET @pc_aims_client_code = COALESCE(@pc_aims_client_code, 'aims.runtime');
SET @pc_assets_client_code = COALESCE(@pc_assets_client_code, 'assets.runtime');
SET @pc_codocs_client_code = COALESCE(@pc_codocs_client_code, 'codocs.runtime');
SET @pc_altoc_client_code = COALESCE(@pc_altoc_client_code, 'altoc.runtime');
SET @pc_finance_client_code = COALESCE(@pc_finance_client_code, 'finance.runtime');
`
const selected = 'SELECT \'aims\' app_code, @pc_aims_client_code client_code UNION ALL SELECT \'assets\', @pc_assets_client_code UNION ALL SELECT \'codocs\', @pc_codocs_client_code UNION ALL SELECT \'altoc\', @pc_altoc_client_code UNION ALL SELECT \'finance\', @pc_finance_client_code'
const seed = `${header}
-- Fail before granting anything unless all five selected clients and their current
-- credentials are active, unexpired and bound to the expected app.
DROP TEMPORARY TABLE IF EXISTS pc_grant_guard;
CREATE TEMPORARY TABLE pc_grant_guard (passed TINYINT NOT NULL CHECK (passed=1));
INSERT INTO pc_grant_guard
SELECT IF(COUNT(*)=5,1,0) FROM (${selected}) chosen
JOIN service_clients sc ON BINARY sc.client_code=BINARY chosen.client_code AND sc.app_code=chosen.app_code AND sc.status='active'
JOIN service_client_credentials cr ON cr.id=sc.current_credential_id AND cr.service_client_id=sc.id AND cr.status='active' AND (cr.expires_at IS NULL OR cr.expires_at>UTC_TIMESTAMP());
START TRANSACTION;
INSERT INTO service_client_grants(service_client_id,resource_code,action,scope_json,status,created_at,updated_at)
SELECT sc.id, expected.resource_code, expected.action,
 JSON_OBJECT('source','seed:product-center-20260907','audience',expected.audience),'active',UTC_TIMESTAMP(),UTC_TIMESTAMP()
FROM (${matrix}) expected
JOIN pc_grant_guard guard_row ON guard_row.passed=1
JOIN (${selected}) chosen ON chosen.app_code=expected.app_code
JOIN service_clients sc ON BINARY sc.client_code=BINARY chosen.client_code AND sc.app_code=chosen.app_code AND sc.status='active'
WHERE expected.install_grant=1
ON DUPLICATE KEY UPDATE scope_json=VALUES(scope_json),status='active',updated_at=UTC_TIMESTAMP();
COMMIT;
DROP TEMPORARY TABLE pc_grant_guard;
`
const verify = `${header}
-- Read-only: returns one result per required client/audience/scope, even when
-- the client is absent. A PASS proves row/credential eligibility, not signing.
-- Both runtime audiences and existing transport scopes must pass. Afterwards
-- probe actual token issuance for every combined scope used by the BFF.
SELECT chosen.client_code,expected.audience,CONCAT(expected.resource_code,':',expected.action) capability,
 CASE WHEN sc.id IS NULL THEN 'FAIL: missing client'
 WHEN sc.app_code IS NULL OR sc.app_code<>expected.app_code OR sc.status<>'active' THEN 'FAIL: client binding/status'
 WHEN cr.id IS NULL OR cr.status<>'active' OR (cr.expires_at IS NOT NULL AND cr.expires_at<=UTC_TIMESTAMP()) THEN 'FAIL: current credential'
 WHEN g.id IS NULL OR g.status<>'active' THEN 'FAIL: missing/inactive exact grant'
 ELSE 'PASS' END result
FROM (${matrix}) expected
JOIN (${selected}) chosen ON chosen.app_code=expected.app_code
LEFT JOIN service_clients sc ON BINARY sc.client_code=BINARY chosen.client_code
LEFT JOIN service_client_credentials cr ON cr.id=sc.current_credential_id AND cr.service_client_id=sc.id
LEFT JOIN service_client_grants g ON g.service_client_id=sc.id AND BINARY g.resource_code=BINARY expected.resource_code AND BINARY g.action=BINARY expected.action
ORDER BY chosen.client_code,expected.audience,capability;
`
for (const [kind, content] of [['Seed', seed], ['Verify', verify]]) {
  const path = new URL(`console/docs/sql/Console-SQL-${kind}-product-center-20260907.sql`, root)
  if (process.argv.includes('--check')) {
    if (readFileSync(path, 'utf8') !== content) throw new Error(`Regenerate ${fileURLToPath(path)}`)
  } else writeFileSync(path, content)
}
