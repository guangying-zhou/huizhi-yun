import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import { assertKnowledgeIdentity, canonicalKnowledgeCommand, knowledgeLinkCapability } from '../server/utils/knowledgeLinkContract'

test('knowledge target identities require exact source, capability and both deployments', () => {
  for (const target of ['assets', 'codocs'] as const) {
    const auth = { authenticated: true, tokenUse: 'service', subjectType: 'service', appCode: 'enterprise', clientCode: 'enterprise.runtime', scopes: [knowledgeLinkCapability(target)], tenant: 'C000001', deployment: 'enterprise-test' }
    const gateway = { appCode: target, tenant: auth.tenant, deployment: `${target}-test` }
    assertKnowledgeIdentity(auth, gateway, target)
    for (const bad of [{ authenticated: false }, { tokenUse: 'user' }, { subjectType: 'user' }]) assert.throws(() => assertKnowledgeIdentity({ ...auth, ...bad }, gateway, target), { statusCode: 401 })
    for (const bad of [{ scopes: [] }, { scopes: ['assets:write'] }, { appCode: 'altoc' }, { clientCode: 'altoc.runtime' }, { tenant: 'other' }, { deployment: '' }]) assert.throws(() => assertKnowledgeIdentity({ ...auth, ...bad }, gateway, target), { statusCode: 403 })
    for (const bad of [{ appCode: 'altoc' }, { tenant: 'other' }, { deployment: '' }]) assert.throws(() => assertKnowledgeIdentity(auth, { ...gateway, ...bad }, target), { statusCode: 403 })
    assert.throws(() => assertKnowledgeIdentity(auth, null, target), { statusCode: 403 })
  }
})
test('knowledge digest uses the same fixed sorted all-string command in both languages', () => {
  const command = { actorUid: '员工', action: 'link', ticketCode: 'T', documentUuid: '00000000-0000-4000-8000-000000000001', customerCode: 'C', contractCode: 'CT', projectCode: 'P', deliveryCode: 'D', deliveryAssetCode: 'A', environmentCode: 'E', targetDeployment: 'assets-test' }
  assert.equal(JSON.stringify(canonicalKnowledgeCommand(command)), '{"action":"link","actorUid":"员工","contractCode":"CT","customerCode":"C","deliveryAssetCode":"A","deliveryCode":"D","documentUuid":"00000000-0000-4000-8000-000000000001","environmentCode":"E","projectCode":"P","targetDeployment":"assets-test","ticketCode":"T"}')
  for (const bad of [{ extra: 'x' }, { projectCode: {} }, { action: 'publish' }, { actorUid: '<x>' }, { documentUuid: 'bad' }]) assert.throws(() => canonicalKnowledgeCommand({ ...command, ...bad }), { statusCode: 403 })
})

test('TS and Go consume the same knowledge golden digest', () => {
  const f = JSON.parse(readFileSync(new URL('./fixtures/knowledge-link-command.json', import.meta.url), 'utf8'))
  const canonical = JSON.stringify(canonicalKnowledgeCommand(f.command))
  assert.equal(canonical, f.canonical)
  assert.equal(createHash('sha256').update(canonical).digest('hex'), f.sha256)
})
