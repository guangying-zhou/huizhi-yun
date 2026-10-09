import { registerHooks } from 'node:module'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8')
test('ticket Host fixes exact U operations, scoped actions and response whitelist', () => {
  const core = read('../server/utils/enterpriseAltocServiceTickets.ts')
  const fields = read('../shared/altoc-service-tickets.ts')
  assert.equal((fields.match(/'service-ticket(?:s)?-[^']+'/g) || []).length, 9)
  for (const token of ['\'service_ticket\'', '\'close\'', '\'reopen\'', 'buildAPFPermit', 'requireEnterpriseUser', 'private, no-store', 'expectedVersion', 'idempotency-key', 'ticketRowFields']) assert.ok(core.includes(token), token)
  assert.ok(!core.includes('aims.read'))
  assert.match(core, /result\.data\.items\.map\(pick\)/)
  const manifest = JSON.parse(read('../../altoc/app.manifest.json'))
  assert.ok(manifest.resources.find(r => r.code === 'service_ticket').actions.includes('reopen'))
  assert.deepEqual(manifest.recommendedRoles.filter(role => role.suggestedPermissions.includes('altoc:service_ticket:reopen')).map(role => role.code).sort(), ['altoc:admin', 'altoc:customer_success'])
})
test('service tickets compile with real pagination, explicit permission and safe actions', () => {
  const source = read('../app/components/AltocServiceTicketsPage.vue')
  const { descriptor, errors } = parse(source)
  assert.deepEqual(errors, [])
  const script = compileScript(descriptor, { id: 'apf16c' })
  const template = compileTemplate({ source: descriptor.template.content, filename: 'AltocServiceTicketsPage.vue', id: 'apf16c', compilerOptions: { bindingMetadata: script.bindings } })
  assert.deepEqual(template.errors, [])
  for (const token of ['ContentPageHeader', 'useDebouncedSearch', 'CommonEmptyState', ':loading="loading"', ':total="total"', '共 {{ total }} 条', 'loadPermissions()', 'hasPermission(\'service_ticket\', \'edit\')', 'hasPermission(\'service_ticket\', \'reopen\')', 'createConsoleMutationIntent', 'useConfirm()', 'description=', 'service_ticket_quota_exceeded']) assert.ok(source.includes(token), token)
  assert.match(source, /grid-cols-1.*sm:grid-cols-2/)
  assert.ok(!/\b(?:alert|prompt)\(/.test(source))
})

test('Ticket real Host handler carries independent actions and rejects before Runtime', async () => {
  globalThis.__tickets = { allowed: true, query: { page: '2', pageSize: '20' }, params: {}, body: {}, calls: [] }
  const hooks = registerHooks({ resolve(specifier, context, next) {
    let source
    if (specifier === 'h3') source = `export const createError=x=>Object.assign(Error('fixed'),x);export const getHeader=()=> 'stable-key';export const getQuery=()=>globalThis.__tickets.query;export const getRouterParam=(e,k)=>globalThis.__tickets.params[k];export const readBody=async()=>globalThis.__tickets.body;export const setHeader=()=>{}`
    if (specifier.endsWith('/enterpriseRuntimeClient')) source = `export const requireEnterpriseUser=async()=>({uid:'Person',tenant:'C000001',deployment:'Host'});export const prepareEnterpriseRuntime=async()=>true;export const callEnterpriseRuntime=async(...args)=>{globalThis.__tickets.calls.push(args);return{code:0,data:args[1].endsWith('-page')?{items:[],total:0}:{id:'1'}}}`
    if (specifier === '../../shared/altoc-service-tickets') return next(specifier + '.ts', context)
    if (specifier === './enterpriseAPF') source = `export const buildAPFPermit=async(e,d,o,i,u,r,a)=>{if(!globalThis.__tickets.allowed)throw Object.assign(Error('fixed'),{statusCode:403});return {resource:r,action:a||'view',objectId:i.id,allowed:true}}`
    if (source) return { url: 'data:text/javascript,' + encodeURIComponent(source), shortCircuit: true }
    return next(specifier, context)
  } })
  try {
    const { enterpriseAltocServiceTickets, normalizeServiceTicketPayload } = await import('../server/utils/enterpriseAltocServiceTickets.ts')
    await enterpriseAltocServiceTickets({}, 'service-tickets-page')
    const read = globalThis.__tickets.calls[0]
    assert.equal(read[2].authorization.resource, 'service_ticket')
    assert.equal(read[2].authorization.action, 'view')
    assert.equal(read[2].sales.payload.page, 2)
    globalThis.__tickets.query = {}
    globalThis.__tickets.body = { title: '标记服务', ticket_type: 'incident', service_agreement_id: '1' }
    await enterpriseAltocServiceTickets({}, 'service-tickets-create')
    const write = globalThis.__tickets.calls[1]
    assert.equal(write[2].authorization.resource, 'service_ticket')
    assert.equal(write[2].authorization.action, 'edit')
    assert.equal(write[3].idempotencyKey, 'stable-key')
    assert.equal(write[2].sales.payload.source_app, undefined)
    globalThis.__tickets.params = { ticketId: '1' }
    globalThis.__tickets.body = { expectedVersion: 1, reason: '确认重开' }
    await enterpriseAltocServiceTickets({}, 'service-tickets-reopen')
    assert.equal(globalThis.__tickets.calls[2][2].authorization.action, 'reopen')
    globalThis.__tickets.params = {}
    globalThis.__tickets.body = { title: '标记服务', service_agreement_id: '1', ticket_type: 'incident' }
    globalThis.__tickets.allowed = false
    await assert.rejects(enterpriseAltocServiceTickets({}, 'service-tickets-create'), { statusCode: 403 })
    assert.equal(globalThis.__tickets.calls.length, 3)
    assert.throws(() => normalizeServiceTicketPayload('service-tickets-create', { title: 'x', service_agreement_id: '1', actor: 'forged' }), { statusCode: 400 })
    assert.throws(() => normalizeServiceTicketPayload('service-tickets-update', { expectedVersion: 0 }), { statusCode: 400 })
    assert.throws(() => normalizeServiceTicketPayload('service-tickets-page', { pageSize: 101 }), { statusCode: 400 })
    assert.throws(() => normalizeServiceTicketPayload('service-tickets-view', { scope: 'all' }), { statusCode: 400 })
  } finally {
    hooks.deregister()
    delete globalThis.__tickets
  }
})
