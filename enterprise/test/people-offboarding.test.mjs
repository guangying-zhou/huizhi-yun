import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { readFileSync } from 'node:fs'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { businessModules } from '../composition/registry.mjs'

test('offboarding BFF closes input and keeps exact employee/version intent', async () => {
  const hooks = registerHooks({ resolve(specifier, context, next) {
    if (specifier === 'h3') return { url: 'data:text/javascript,' + encodeURIComponent('export const createError=x=>Object.assign(Error("closed"),x);export const getHeader=()=>"key";export const getQuery=()=>({});export const getRouterParam=()=>"";export const readBody=async()=>({});export const setHeader=()=>{}'), shortCircuit: true }
    if (specifier.endsWith('/enterprisePeopleFactsPermit')) return next(new URL('../../foundation/server/utils/enterprisePeopleFactsPermit.ts', import.meta.url).href, context)
    if (specifier === './enterprisePeopleFacts') return { url: 'data:text/javascript,export const executePeopleFacts=async()=>{}', shortCircuit: true }
    return next(specifier, context)
  } })
  try {
    const { normalizeOffboarding } = await import('../server/utils/enterprisePeopleOffboarding.ts')
    const body = { employeeUid: 'Person', expectedVersion: 2, handoverResponsibleUid: 'HR', handoverDueAt: '2030-01-01T00:00:00Z', assetRecoveryResponsibleUid: 'Assets', assetRecoveryDueAt: '2030-01-02T00:00:00Z' }
    const facts = normalizeOffboarding('offboarding-arrange', '1', body)
    assert.equal(facts.payload.expectedVersion, 2)
    assert.equal(facts.employeeUid, 'Person')
    assert.equal(facts.sensitiveAllowed, false)
    for (const bad of [{ ...body, actor: 'Other' }, { ...body, trusted: true }, { ...body, expectedVersion: 0 }, { ...body, employeeUid: 'dt-123' }]) assert.throws(() => normalizeOffboarding('offboarding-arrange', '1', bad), { statusCode: 400 })
    assert.throws(() => normalizeOffboarding('offboarding-view', '1', { employeeUid: 'Person' }), { statusCode: 400 })
    assert.throws(() => normalizeOffboarding('offboarding-list', '', { pageSize: 101 }), { statusCode: 400 })
    assert.deepEqual(normalizeOffboarding('offboarding-list', '', { page: '2', pageSize: '20' }).payload, {})
  } finally { hooks.deregister() }
})

test('offboarding pages register and SFC compiles with independent sensitive actions', () => {
  const people = businessModules.find(m => m.code === 'people')
  for (const path of ['/offboarding', '/offboarding/:id']) assert.ok(people.pages.some(p => p.path === path))
  const source = readFileSync(new URL('../app/components/PeopleOffboardingPage.vue', import.meta.url), 'utf8')
  const { descriptor, errors } = parse(source)
  assert.deepEqual(errors, [])
  const script = compileScript(descriptor, { id: 'offboarding' })
  assert.deepEqual(compileTemplate({ source: descriptor.template.content, filename: 'offboarding.vue', id: 'offboarding', compilerOptions: { bindingMetadata: script.bindings } }).errors, [])
  for (const required of ['hasPermission(\'offboarding_tasks\', action)', 'useConfirm()', 'createConsoleMutationIntent', 'Idempotency-Key', 'intent.uncertain', 'structuredClone(body)', 'expectedVersion', 'useDebouncedSearch', 'CommonEmptyState', ':loading="pending"', 'UPagination', '共 {{ total }} 条']) assert.ok(source.includes(required), required)
})

test('offboarding six Runtime/Host bindings agree and no approval/force action exists', async () => {
  const { peopleFactsOperations } = await import('../../foundation/server/utils/enterprisePeopleFactsPermit.ts')
  const runtime = readFileSync(new URL('../../data-runtime/internal/server/enterprise_people_facts.go', import.meta.url), 'utf8')
  const host = readFileSync(new URL('../../foundation/server/utils/enterpriseRuntimeClient.ts', import.meta.url), 'utf8')
  const expected = { list: 'view', view: 'view', create: 'admin', arrange: 'admin', confirm: 'confirm', cancel: 'cancel' }
  assert.equal(Object.keys(peopleFactsOperations).filter(k => k.startsWith('offboarding-')).length, 6)
  for (const [op, action] of Object.entries(expected)) {
    const [resource, actual, path] = peopleFactsOperations[`offboarding-${op}`]
    assert.equal(resource, 'offboarding_tasks')
    assert.equal(actual, action)
    assert.ok(runtime.includes(`"${path}"`))
    assert.ok(host.includes(`'people.apf09c1-offboarding-${op}'`))
  }
})
