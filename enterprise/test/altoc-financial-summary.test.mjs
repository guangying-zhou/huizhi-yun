import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8')
test('16g has exactly two read-only Host operations and independent Finance scope projection', () => {
  const s = read('../server/utils/enterpriseAltocFinancialSummary.ts')
  for (const r of ['invoices', 'receipts', 'reconciliation', 'project_accounting']) assert.ok(s.includes(`'${r}'`))
  assert.match(s, /resolveFinanceResponsibilityAccessFromGrants/)
  assert.match(s, /financeProjectAccountingScopeQuery/)
  assert.match(s, /financeAuthorization: JSON.stringify\(disclosure\)/)
  assert.match(s, /private, no-store/)
  assert.doesNotMatch(s, /Idempotency-Key|readBody|count\(\*\)/i)
  for (const [path, op] of [['customers/[customerId]/service-finance-summary', 'customer-service-finance-summary'], ['service-agreements/[agreementId]/cost-summary', 'service-cost-summary-view']]) assert.match(read(`../server/routes/altoc/api/v1/${path}.get.ts`), new RegExp(`'${op}'`))
  assert.match(s, /source.access === 'denied'\) return \{ access: 'denied' \}/)
})
test('16g summary UI compiles with denial, unavailable, not-ready and narrow layout states', () => {
  const s = read('../app/components/AltocFinancialSummaryPanel.vue')
  const { descriptor, errors } = parse(s)
  assert.deepEqual(errors, [])
  compileScript(descriptor, { id: 'summary' })
  assert.deepEqual(compileTemplate({ source: descriptor.template.content, filename: 'summary.vue', id: 'summary' }).errors, [])
  for (const expected of ['无权查看', '暂不可用', '尚未核算', 'grid-cols-1', 'md:grid-cols-3', 'formatMoney', 'epoch', 'enterprise-cache-scope']) assert.ok(s.includes(expected), expected)
  assert.ok(read('../app/components/AltocCustomersPage.vue').includes('<AltocFinancialSummaryPanel :customer-id="String(customer.id)"'))
  assert.ok(read('../app/components/AltocServiceAgreementsPage.vue').includes('<AltocFinancialSummaryPanel :agreement-id="String(record.id)"'))
})

test('16g response rebuild removes hidden counts and unconfirmed costs', async () => {
  const { registerHooks } = await import('node:module')
  const hooks = registerHooks({ resolve(specifier, context, next) {
    let source
    if (specifier === 'h3') source = `export const createError=x=>Object.assign(new Error('fixed'),x);export const getQuery=()=>({});export const getRouterParam=()=> '1';export const setHeader=()=>{}`
    if (specifier.endsWith('/enterpriseRuntimeClient')) source = `export const callEnterpriseRuntime=()=>{};export const prepareEnterpriseRuntime=()=>{};export const requireEnterpriseUser=()=>{};export const enterpriseRuntimePermitExpiresAt=()=>0`
    if (specifier.endsWith('/platformBundleAuthorization')) source = `export const loadScopedAuthorizationFromConsoleRuntime=()=>{}`
    if (specifier.endsWith('/financeScopedAuthorization')) source = `export const financeProjectAccountingScopeQuery=()=>{};export const resolveFinanceResponsibilityAccessFromGrants=()=>{}`
    if (specifier === './enterpriseAPF') source = `export const buildAPFPermit=()=>{}`
    if (source) return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true }
    return next(specifier, context)
  } })
  try {
    const { serviceSummaryPublicResponse: rebuild } = await import('../server/utils/enterpriseAltocFinancialSummary.ts')
    for (const op of ['customer-service-finance-summary', 'service-cost-summary-view']) assert.deepEqual(rebuild(op, { access: 'denied', count: 999, total: 999, items: [{ secret: 1 }] }), { access: 'denied' })
    const sections = { access: 'allowed', invoices: { access: 'denied', count: 999 }, receipts: { access: 'allowed', currencyTotals: [{ currency: 'CNY', amount: '10.00', count: 1, secret: 1 }] }, reconciliation: { access: 'denied', total: 999 } }
    const out = rebuild('customer-service-finance-summary', sections)
    assert.deepEqual(out.invoices, { access: 'denied' })
    assert.deepEqual(out.receipts.currencyTotals, [{ currency: 'CNY', amount: '10.00', count: 1 }])
    assert.throws(() => rebuild('customer-service-finance-summary', { ...sections, receipts: { access: 'allowed', currencyTotals: [{ currency: 'CNY', amount: 'bad', count: 1 }] } }), { statusCode: 503 })
    const cost = rebuild('service-cost-summary-view', { access: 'allowed', total: 999, items: [{ projectCode: 'P1', readiness: 'not_ready', laborCostAmount: '100', grossMarginRate: '1', employeeUid: 'private' }] })
    assert.equal(cost.items[0].laborCostAmount, null)
    assert.equal(cost.items[0].grossMarginRate, null)
    assert.equal('employeeUid' in cost.items[0], false)
    assert.equal('total' in cost, false)
  } finally { hooks.deregister() }
})
