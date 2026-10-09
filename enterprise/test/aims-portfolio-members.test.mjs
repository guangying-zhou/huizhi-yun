import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { businessApiRoutes } from '../composition/business-api-routes.generated.mjs'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const util = read('../server/utils/enterpriseAimsPortfolios.ts')
const client = read('../../foundation/server/utils/enterpriseRuntimeClient.ts')
const spec = read('../../data-runtime/internal/server/enterprise_project_portfolios.go')
const adapter = read('../../data-runtime/internal/apps/aims/portfolio_members.go')

// Document asset design DOC-05a.
test('portfolio member operations stay inside the existing Aims Host capability', () => {
  for (const [operation, action] of [
    ['aims.project-portfolio-members-list', 'members-list'],
    ['aims.project-portfolio-members-save', 'members-save'],
    ['aims.project-portfolio-doc-repo-save', 'doc-repo-save']
  ]) {
    assert.match(client, new RegExp(`'${operation}': \\{ path: '/v1/enterprise/aims/project-portfolios:${action}' \\}`))
    assert.match(spec, new RegExp(`"${action}": \\{`))
    assert.match(util, new RegExp(`'${operation}'`))
  }
  // No new service capability: the path keeps deriving aims:enterprise-host:execute.
  assert.doesNotMatch(client + spec + util, /portfolio-members:(?:read|write|execute)|aims:portfolio/)
})

test('Host routes are registered and writes require the personnel permission and an intent key', () => {
  const routes = JSON.stringify(businessApiRoutes)
  for (const route of ['GET /aims/api/v1/portfolios/:id/members', 'PUT /aims/api/v1/portfolios/:id/members', 'PUT /aims/api/v1/portfolios/:id/doc-repo']) {
    const [method, path] = route.split(' ')
    assert.ok(routes.includes(path) && routes.includes(method), route)
  }
  const save = util.slice(util.indexOf('export async function enterpriseAimsPortfolioMemberSave'))
  assert.match(save, /exactPayload\(await payloadOf\(event\), memberKeys/)
  assert.match(save, /idempotencyKey: requireIntentKey\(event\)/)
  // Writes fall into the admin branch; the list only needs portfolios:view.
  assert.match(util, /operation === 'aims\.project-portfolio-members-list'[\s\S]*?'portfolios', 'view'/)
  assert.match(util, /operation !== 'aims\.project-portfolio-list'[\s\S]*?'portfolios', 'admin'[\s\S]*?current_user_can_manage_portfolios = '1'/)
  assert.match(util, /delete query\.current_user_can_manage_portfolios/)
  // The browser can never name the acting user or the manage flag.
  assert.doesNotMatch(util.slice(util.indexOf('const memberKeys')), /actorUid|current_user(?!_can)|operator/)
})

test('Runtime rechecks permission and current relation on locked rows', () => {
  assert.match(adapter, /SELECT owner_uid FROM project_portfolios WHERE id=\?"\+lock/)
  assert.match(adapter, /return p\.canAdminister && \(p\.isOwner \|\| p\.isManager\)/)
  // An owner who is no longer an active employee counts as no owner (5b-1).
  assert.match(adapter, /return p\.canAdminister && p\.effectiveOwner\(\) == "" && p\.managers == 0/)
  assert.match(adapter, /losesManager && actor\.effectiveOwner\(\) == "" && actor\.managers <= 1/)
  assert.match(adapter, /actor\.isOwner = actor\.effectiveOwner\(\) != "" && actor\.owner == actor\.uid/)
  assert.match(adapter, /portfolio_last_manager_required/)
  assert.match(adapter, /actor := portfolioMemberActor\{uid: strings\.TrimSpace\(query\.Get\("current_user"\)\)\}/)
  // Not installed -> fixed 503, never a fallback to an unmapped table.
  assert.match(adapter, /aims_portfolio_members_unavailable/)
  assert.doesNotMatch(adapter, /VerifyCompatibilityViews/)
})
