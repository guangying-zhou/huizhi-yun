import test from 'node:test'
import assert from 'node:assert/strict'
import { productReachCreateInput, productReachReadInput } from '../server/utils/productReachInput'
const item = '00000000-0000-4000-8000-000000000001'
const observation = '00000000-0000-4000-8000-000000000002'
const draft = { expectedRevision: 1, expectedItemRevision: 2, expectedScopeRevision: 3, expectedEvidenceRevision: 4, modelVersion: 'rice-v1', reach: 450, sourceReference: 'report-q4', methodology: '按 UID 去重' }
test('Reach input binds item identity and preserves known zero', () => {
 assert.deepEqual(productReachCreateInput(draft, item), { item_biz_id: item, model_version: 'rice-v1', expected_revision: 1, expected_item_revision: 2, expected_scope_revision: 3, expected_evidence_revision: 4, reach: 450, source_reference: 'report-q4', methodology: '按 UID 去重' })
 assert.equal(productReachCreateInput({ ...draft, reach: 0 }, item)?.reach, 0)
 assert.equal(productReachCreateInput(draft, 'invalid'), null)
})
test('Reach input rejects missing facts and caller authority or model definitions', () => {
 for (const patch of [{ reach: null }, { reach: '450' }, { reach: -1 }, { reach: 1.5 }, { reach: 1000000001 }, { expectedEvidenceRevision: 0 }, { expectedScopeRevision: '3' }, { sourceReference: '' }, { methodology: '' }, { modelVersion: 'rice/v1' }, { recordedBy: 'other' }, { recordedAt: '2026-01-01' }, { verified: true }, { item_biz_id: observation }, { snapshot: {} }, { reachUnit: 'unique_users' }, { authorization: {} }]) assert.equal(productReachCreateInput({ ...draft, ...patch }, item), null)
})
test('Reach read input binds route and strict pagination', () => {
 assert.deepEqual(productReachReadInput({ page: '2', pageSize: '10' }, item), { item_biz_id: item, page: 2, page_size: 10 })
 assert.deepEqual(productReachReadInput({}, item, observation), { item_biz_id: item, biz_id: observation })
 for (const query of [{ actor: 'other' }, { page: '0' }, { pageSize: '101' }, { page: ['1'] }]) assert.equal(productReachReadInput(query, item), null)
 assert.equal(productReachReadInput({ page: '1' }, item, observation), null)
 assert.equal(productReachReadInput({}, item, 'bad'), null)
})
