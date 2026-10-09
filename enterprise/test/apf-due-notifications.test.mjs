import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { readFileSync } from 'node:fs'

const hooks = registerHooks({ resolve(specifier, context, next) {
  const sources = {
    'h3': `export const createError=x=>Object.assign(new Error('fixed'),x)`,
    '@hzy/foundation/server/utils/enterpriseRuntimeChannels': `export const callEnterpriseAPFDueWorker=async()=>{throw new Error('unexpected live Runtime')};export const callEnterpriseNotificationRuntime=async()=>{throw new Error('unexpected live Runtime')}`,
    '@hzy/foundation/server/utils/notifications': `export const publishNotification=async()=>{throw new Error('unexpected network')};export const advanceNotificationActionableLifecycle=async()=>{throw new Error('unexpected network')}`,
    '@hzy/foundation/server/utils/subjectEligibility': `export const checkSubjectEligibility=async()=>{throw new Error('unexpected network')}`
  }
  return sources[specifier] ? { url: `data:text/javascript,${encodeURIComponent(sources[specifier])}`, shortCircuit: true } : next(specifier, context)
} })
const { drainEnterpriseAPFDue } = await import('../server/utils/enterpriseAPFDueDelivery.ts')
hooks.deregister()
const event = { context: {} }
function fixture() {
  const c = { id: 1, family: 'sales-due', sourceKind: 'lead', sourceId: 1, sourceCode: 'LE-1', recipientUid: 'Owner', dueAt: '2026-10-01T00:00:00Z', eventKey: 'apf-due:sales-due:lead:1:1', objectVersion: 'apf-due:sales-due:lead:1:1', notificationId: '', closureState: '', recoveryOnly: false }
  const calls = []
  let eligible = true
  let phase = 'publish'
  let failAck = false
  let absent = false
  const deps = {
    env: { HZY_ENTERPRISE_ALTOC_SALES_DUE_ENABLED: 'true', HZY_ALTOC_SALES_DUE_NOTIFICATIONS_ENABLED: 'false' }, now: () => 0,
    runtime: async (_event, family, op, body) => {
      calls.push(['runtime', family, op, body])
      if (op === 'scan-due')
        return { code: 0, data: { items: phase === 'publish' ? [{ ...c }] : [], closures: phase === 'close' ? [{ ...c, notificationId: 'N1', closureState: 'cancelled' }] : [] } }
      if (failAck)
        throw Object.assign(new Error('fixed'), { statusCode: 503 })
      return { code: 0, data: { acknowledged: true } }
    }, eligibility: async (arg) => {
      calls.push(['eligibility', arg])
      return { active: true, allowed: eligible, reason: eligible ? 'allowed' : 'permission_denied', policyRevision: 41 }
    },
    publish: async (arg) => {
      calls.push(['publish', arg])
      return absent ? { found: false } : { notificationId: 'N1', recipients: ['Owner'] }
    },
    close: async (arg) => {
      calls.push(['close', arg])
    }
  }
  return { c, calls, deps, eligible: (x) => {
    eligible = x
  }, phase: (x) => {
    phase = x
  }, failAck: (x) => {
    failAck = x
  }, absent: (x) => {
    absent = x
  } }
}
test('disabled or legacy owner still enabled performs zero token/network calls', async () => {
  for (const env of [{}, { HZY_ENTERPRISE_ALTOC_SALES_DUE_ENABLED: 'true' }, { HZY_ENTERPRISE_ALTOC_SALES_DUE_ENABLED: 'true', HZY_ALTOC_SALES_DUE_NOTIFICATIONS_ENABLED: 'true' }]) {
    const f = fixture()
    await drainEnterpriseAPFDue(event, 'altoc', { ...f.deps, env })
    assert.equal(f.calls.length, 0)
  }
})
test('explicit owner uses exact recipient/eligibility and stable key; ACK failure retries original request', async () => {
  const f = fixture()
  f.failAck(true)
  await drainEnterpriseAPFDue(event, 'altoc', f.deps)
  f.failAck(false)
  await drainEnterpriseAPFDue(event, 'altoc', f.deps)
  const publishes = f.calls.filter(c => c[0] === 'publish').map(c => c[1])
  assert.equal(publishes.length, 2)
  assert.deepEqual(publishes[0], publishes[1])
  assert.equal(publishes[0].title, '销售下一步已到期')
  assert.equal(publishes[0].summary, '请核对当前负责的事项。')
  assert.equal(publishes[0].body, '此提醒不代表审批、开票、核销或归还已完成。')
  assert.equal(publishes[0].actionUrl, '/enterprise/notifications')
  assert.equal(publishes[0].sourceAppCode, 'enterprise')
  assert.deepEqual(publishes[0].recipients, ['Owner'])
  assert.deepEqual(publishes[0].channels, ['in_app'])
  assert.equal(publishes[0].metadata.authorizationDescriptor.resource, 'apf_sales_lead_due')
  assert.equal(f.calls.find(c => c[0] === 'eligibility')[1].purpose, 'apf_sales_lead_due')
})
test('permission denied or eligibility dependency failure never publishes or acknowledges', async () => {
  const f = fixture()
  f.eligible(false)
  await drainEnterpriseAPFDue(event, 'altoc', f.deps)
  assert.equal(f.calls.filter(c => c[0] === 'publish').length, 0)
  f.deps.eligibility = async () => {
    throw Object.assign(new Error('fixed'), { statusCode: 503 })
  }
  await drainEnterpriseAPFDue(event, 'altoc', f.deps)
  assert.equal(f.calls.filter(c => c[0] === 'runtime' && c[2] === 'published').length, 0)
})
test('changed owner with uncertain publish only probes; absence is not a success or closure ACK', async () => {
  const f = fixture()
  f.c.recoveryOnly = true
  f.c.closureState = 'cancelled'
  f.absent(true)
  await drainEnterpriseAPFDue(event, 'altoc', f.deps)
  assert.equal(f.calls.filter(c => c[0] === 'eligibility').length, 0)
  assert.equal(f.calls.find(c => c[0] === 'publish')[1].probeOnly, true)
  assert.equal(f.calls.filter(c => c[0] === 'runtime' && c[2] !== 'scan-due').length, 0)
  f.absent(false)
  await drainEnterpriseAPFDue(event, 'altoc', f.deps)
  assert.equal(f.calls.filter(c => c[0] === 'runtime' && c[2] === 'published').length, 1)
  f.phase('close')
  await drainEnterpriseAPFDue(event, 'altoc', f.deps)
  assert.equal(f.calls.find(c => c[0] === 'close')[1].actionableKey, f.c.eventKey)
  assert.equal(f.calls.at(-1)[2], 'closure-ack')
})
test('cross-family candidate or malformed receipt cannot ACK', async () => {
  const f = fixture()
  f.c.family = 'billing-due'
  await drainEnterpriseAPFDue(event, 'altoc', f.deps)
  assert.equal(f.calls.filter(c => c[0] === 'publish').length, 0)
  f.c.family = 'sales-due'
  f.deps.publish = async () => ({ notificationId: 'N1', recipients: ['Other'] })
  await drainEnterpriseAPFDue(event, 'altoc', f.deps)
  assert.equal(f.calls.filter(c => c[0] === 'runtime' && c[2] === 'published').length, 0)
})
test('deadline bounds the pass and no replacement timer is registered', async () => {
  const f = fixture()
  let n = 0
  f.deps.now = () => n++ === 0 ? 0 : 20001
  await drainEnterpriseAPFDue(event, 'altoc', f.deps)
  assert.equal(f.calls.filter(c => c[0] === 'publish').length, 0)
  const route = readFileSync(new URL('../server/routes/enterprise/api/internal/apf/scheduler-inspect.post.ts', import.meta.url), 'utf8')
  assert.match(route, /callEnterpriseAPFScheduler/)
  assert.match(route, /drainEnterpriseAPFDue/)
})

test('due seed candidates separate dual-audience scheduler/P scopes from Console publishing and never revive grants', () => {
  const read = name => readFileSync(new URL(`../../console/docs/sql/${name}`, import.meta.url), 'utf8')
  for (const kind of ['Seed', 'Verify']) {
    const due = read(`Console-SQL-${kind}-apf18b1-enterprise-notifications.sql`)
    for (const domain of ['altoc', 'finance', 'people'])
      for (const audience of ['data-runtime', 'tenant-runtime']) {
        assert.ok(due.includes(`'${audience}:${domain}:notification-detail'`))
        assert.ok(due.includes(`'${domain}:notification-detail:authorize'`))
      }
    for (const scope of ['notifications:publish', 'console:authorization:subject-eligibility', 'enterprise:notification-detail:authorize'])
      assert.ok(due.includes(`'${scope}'`))
    assert.match(due, /tenantCode/)
    assert.match(due, /deploymentCode/)
    const scheduler = read(`Console-SQL-${kind}-apf18-enterprise-scheduler.sql`)
    for (const domain of ['altoc', 'finance', 'people'])
      assert.ok(scheduler.includes(`'${domain}'`))
    for (const audience of ['data-runtime', 'tenant-runtime'])
      assert.ok(scheduler.includes(`'${audience}'`))
    assert.ok(scheduler.includes('CONCAT(a.audience,\':\',d.domain,\':scheduler\')'))
    assert.ok(scheduler.includes('CONCAT(d.domain,\':scheduler:execute\')'))
  }
  const seed = read('Console-SQL-Seed-apf18b1-enterprise-notifications.sql')
  assert.match(seed, /NOT EXISTS/)
  assert.doesNotMatch(seed, /UPDATE\s+service_client_grants|DELETE\s+FROM\s+service_client_grants/i)
})

test('People handover and asset recovery each use their own original key and confirmed closure', async () => {
  const f = fixture()
  f.deps.env = { HZY_ENTERPRISE_PEOPLE_HANDOVER_DUE_ENABLED: 'true', HZY_ENTERPRISE_PEOPLE_ASSET_RECOVERY_DUE_ENABLED: 'true', HZY_PEOPLE_OFFBOARDING_NOTIFICATIONS_ENABLED: 'false' }
  let closing = false
  f.deps.runtime = async (_e, family, op, body) => {
    f.calls.push(['runtime', family, op, body])
    const c = { ...f.c, family, sourceKind: 'offboarding_task', eventKey: `apf-due:${family}:offboarding_task:1:1`, objectVersion: `apf-due:${family}:offboarding_task:1:1` }
    if (op === 'scan-due')
      return { code: 0, data: { items: closing ? [] : [c], closures: closing ? [{ ...c, notificationId: 'N1', closureState: 'resolved' }] : [] } }
    return { code: 0 }
  }
  const first = await drainEnterpriseAPFDue(event, 'people', f.deps)
  for (const family of ['handover-due', 'asset-recovery-due'])
    assert.equal(first[family].published, 1)
  const published = f.calls.filter(c => c[0] === 'publish').map(c => c[1])
  assert.equal(new Set(published.map(p => p.idempotencyKey)).size, 2)
  for (const p of published) {
    assert.deepEqual(p.recipients, ['Owner'])
    assert.deepEqual(p.channels, ['in_app'])
    assert.equal(p.sourceAppCode, 'enterprise')
  }
  closing = true
  const last = await drainEnterpriseAPFDue(event, 'people', f.deps)
  for (const family of ['handover-due', 'asset-recovery-due'])
    assert.equal(last[family].closed, 1)
  assert.deepEqual(new Set(f.calls.filter(c => c[0] === 'close').map(c => c[1].actionableKey)), new Set(published.map(p => p.idempotencyKey)))
  const disabled = fixture()
  disabled.deps.env = {}
  await drainEnterpriseAPFDue(event, 'people', disabled.deps)
  assert.deepEqual(disabled.calls, [])
})
