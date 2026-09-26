/* Manual local visual acceptance scaffold; intentionally outside `pnpm test` glob.
 * NOT passing acceptance evidence: the unsigned local fixture is rejected by
 * server-side OIDC verification. A controlled, verifiable test session is needed.
 * Never disable production authentication to make this scaffold pass.
 */
import assert from 'node:assert/strict'
import { chromium } from 'playwright-chromium'
import { businessModules } from '../composition/registry.mjs'

const origin = process.env.HZY_BROWSER_ORIGIN || 'http://localhost:3010'
const screenshots = '/tmp/adr019-browser'
const ids = [...new Set([
  ...businessModules.flatMap(module => (module.navigation || []).map(item => item.id)),
  ...businessModules.flatMap(module => (module.objectWorkspaces || []).flatMap(workspace => [
    `${workspace.code}.overview`,
    ...workspace.groups.flatMap(group => [`${workspace.code}.${group.id}`, ...group.items.map(item => item.id)])
  ]))
])]
const tokenHeader = { alg: 'RS256', typ: 'JWT', kid: 'fixture' }
const tokenPayload = { sub: 'user:fixture-user', uid: 'fixture-user', tenant: 'C000001', hzy: { uid: 'fixture-user', subjectCode: 'subject-fixture' }, iss: 'http://localhost:3010', aud: 'enterprise', token_use: 'access', exp: Math.floor(Date.now() / 1000) + 3600 }
const token = `${Buffer.from(JSON.stringify(tokenHeader)).toString('base64url')}.${Buffer.from(JSON.stringify(tokenPayload)).toString('base64url')}.fixture-signature`
const browser = await chromium.launch({ headless: true })

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const page = await context.newPage()
  page.setDefaultTimeout(45000)
  const errors = []
  page.on('console', message => { if (message.type() === 'error') { errors.push(message.text()); console.error(`BROWSER console.error: ${message.text()}`) } })
  page.on('pageerror', error => { errors.push(error.message); console.error(`BROWSER pageerror: ${error.message}`) })
  page.on('requestfailed', request => errors.push(`requestfailed ${request.method()} ${new URL(request.url()).pathname}: ${request.failure()?.errorText || 'unknown'}`))
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) console.log(`NAV ${new URL(frame.url()).pathname}${new URL(frame.url()).search}`) })
  await context.addCookies([
    { name: 'hzy_enterprise_access_token', value: token, url: origin },
    { name: 'hzy_enterprise_uid', value: 'fixture-user', url: origin },
    { name: 'hzy_enterprise_tenant', value: 'C000001', url: origin },
    { name: 'hzy_enterprise_subject_code', value: 'subject-fixture', url: origin },
    { name: 'hzy_enterprise_policy_ver', value: 'fixture-policy', url: origin }
  ])
  await page.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') return route.abort()
    if (url.pathname === '/enterprise/api/auth/me' || url.pathname === '/api/auth/me') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ authenticated: true, refreshable: false, provider: 'console_oidc', uid: 'fixture-user', subjectCode: 'subject-fixture', tenant: 'C000001', deployment: 'fixture-enterprise', policyVersion: 'fixture-policy', claims: { uid: 'fixture-user', tenant: 'C000001' } }) })
    if (url.pathname === '/api/user/applications') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ code: 0, data: [] }) })
    if (url.pathname === '/api/directory/users' || url.pathname.startsWith('/api/directory/')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ code: 0, data: { items: [], total: 0, page: 1, pageSize: 500 } }) })
    if (url.pathname.startsWith('/api/v1/console/runtime/')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ code: 0, data: {} }) })
    if (url.pathname === '/enterprise/api/navigation') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ visibleIds: ids, maxAgeMs: 60_000 }) })
    if (url.pathname === '/aims/api/v1/projects/1') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ code: 0, data: { id: 1, name: 'Alpha project', projectCode: 'ALPHA', can_access: true, current_user_role: 'manager', canAccess: true, currentUserRole: 'manager' } }) })
    if (url.pathname === '/aims/api/v1/projects') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ code: 0, data: { items: [{ id: 1, name: 'Alpha project', projectCode: 'ALPHA' }], total: 1, page: 1, pageSize: 20 } }) })
    if (url.pathname.startsWith('/aims/api/v1/')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ code: 0, data: { items: [], total: 0, page: 1, pageSize: 20 } }) })
    return route.continue()
  })
  const waitReady = async () => { await page.waitForLoadState('domcontentloaded'); await page.waitForTimeout(3000) }

  await page.goto(`${origin}/aims/projects/new`); await waitReady()
  await page.screenshot({ path: `${screenshots}-new-desktop.png`, fullPage: true })
  console.log(`NEW body=${JSON.stringify((await page.locator('body').innerText()).slice(0, 500))} html=${(await page.locator('body').innerHTML()).slice(0, 500)}`)
  assert.equal(new URL(page.url()).pathname, '/aims/projects/new')
  assert.ok(await page.getByText('创建项目', { exact: true }).count(), 'new page must render its heading')
  assert.equal(await page.getByRole('link', { name: '项目概览' }).count(), 0, 'new page must not show object navigation')

  await page.goto(`${origin}/aims/projects/1`); await waitReady()
  await page.screenshot({ path: `${screenshots}-detail-desktop.png`, fullPage: true })
  await page.getByText('Alpha project', { exact: true }).first().waitFor()
  assert.ok(await page.getByText('里程碑', { exact: true }).count(), 'detail must show object child navigation')
  await page.getByRole('link', { name: '里程碑' }).click(); await waitReady()
  assert.equal(new URL(page.url()).pathname, '/aims/projects/1/plan')
  assert.ok(await page.getByText('Alpha project', { exact: true }).count(), 'object identity must survive child navigation')
  await page.getByRole('button', { name: '收起侧栏' }).click()
  assert.ok(await page.getByRole('button', { name: /项目导航：Alpha project/ }).count(), 'collapsed sidebar must retain object identity')

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`${origin}/aims/projects/1/plan`); await waitReady()
  await page.screenshot({ path: `${screenshots}-object-mobile.png`, fullPage: true })
  await page.getByRole('button', { name: '打开业务导航' }).click()
  assert.ok(await page.getByText('Alpha project', { exact: true }).count(), 'mobile drawer must retain object identity')
  await page.getByRole('link', { name: '返回项目总览' }).click(); await waitReady()
  assert.equal(new URL(page.url()).pathname, '/aims/projects')
  assert.equal(errors.length, 0, `browser console errors: ${errors.join('\n')}`)
  console.log(JSON.stringify({ origin, screenshots, authenticatedFixture: 'fixture-user/C000001', consoleErrors: errors.length }))
} finally {
  await browser.close()
}
