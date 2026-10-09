import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { enterpriseAPFPermitCanonical } from '../server/utils/enterpriseAPFPermit'
import { peopleFactsOperations } from '../server/utils/enterprisePeopleFactsPermit'

test('People c1 TS/Go golden binds every field and sensitive fact', () => {
  const f = JSON.parse(readFileSync(new URL('./fixtures/enterprise-people-facts-permit.json', import.meta.url), 'utf8'))
  assert.equal(enterpriseAPFPermitCanonical(f.method, f.target, f.body), f.canonical)
  for (const [key, value] of Object.entries(f.body.peopleFacts)) {
    const changed = structuredClone(f.body)
    changed.peopleFacts[key] = typeof value === 'boolean' ? !value : typeof value === 'number' ? value + 1 : key === 'payload' ? { ...value as Record<string, unknown>, dept_code: 'Other' } : 'Other'
    assert.notEqual(enterpriseAPFPermitCanonical(f.method, f.target, changed), f.canonical, key)
  }
  assert.equal(Object.keys(peopleFactsOperations).filter(k => !k.startsWith('hr-') && !k.startsWith('offboarding-') && !k.startsWith('directory-operations-')).length, 24)
  assert.equal(Object.keys(peopleFactsOperations).filter(k => k.startsWith('hr-')).length, 11)
  assert.equal(Object.hasOwn(peopleFactsOperations, 'provision'), false)
  assert.equal(Object.hasOwn(peopleFactsOperations, 'approve'), false)
})

test('People c2 nested target confirmations match Go canonical and bind every fact', () => {
  const f = JSON.parse(readFileSync(new URL('./fixtures/enterprise-people-provisioning-permit.json', import.meta.url), 'utf8'))
  assert.equal(enterpriseAPFPermitCanonical(f.method, f.target, f.body), f.canonical)
  const reordered = structuredClone(f.body)
  reordered.peopleFacts.payload.confirmation = Object.fromEntries(Object.entries(reordered.peopleFacts.payload.confirmation).reverse())
  assert.equal(enterpriseAPFPermitCanonical(f.method, f.target, reordered), f.canonical)
  for (const key of Object.keys(f.body.peopleFacts.payload.confirmation)) {
    const changed = structuredClone(f.body)
    changed.peopleFacts.payload.confirmation[key] = 'tampered'
    assert.notEqual(enterpriseAPFPermitCanonical(f.method, f.target, changed), f.canonical, key)
  }
})

test('People recovery TS/Go golden binds original operation, version and replay reason', () => {
  const f = JSON.parse(readFileSync(new URL('./fixtures/enterprise-people-directory-recovery-permit.json', import.meta.url), 'utf8'))
  assert.equal(enterpriseAPFPermitCanonical(f.method, f.target, f.body), f.canonical)
  assert.equal(Object.keys(peopleFactsOperations).filter(k => k.startsWith('directory-operations-')).length, 3)
  for (const [key, value] of Object.entries({ id: 'Other', payload: { ...f.body.peopleFacts.payload, expectedVersion: 8 }, sensitiveAllowed: true })) {
    const changed = structuredClone(f.body)
    changed.peopleFacts[key] = value
    assert.notEqual(enterpriseAPFPermitCanonical(f.method, f.target, changed), f.canonical)
  }
})
