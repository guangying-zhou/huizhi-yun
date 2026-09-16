import test from 'node:test'
import assert from 'node:assert/strict'
import { productModelCreateInput, productModelSelectInput, productModelPageInput, productRICEModelCreateInput } from '../server/utils/productModelInput'
const cycle = '00000000-0000-4000-8000-000000000001'
const create = { expectedRevision: 2, title: '用户价值', reason: '调整取舍', version: 'customer-v2', strategic: 10, userValue: 60, business: 20, risk: 10 }
test('model creation validates weights and rejects frozen rules or authority overrides', () => {
 assert.deepEqual(productModelCreateInput(create)?.model, { version: 'customer-v2', strategic: 10, user_value: 60, business: 20, risk: 10 })
 for (const change of [{ strategic: 15 }, { strategic: 11, userValue: 59 }, { strategic: -5, userValue: 75 }, { userValue: '60' }, { version: 'weighted-value-effort-v1' }, { version: 'v2/other' }, { configuration: {} }, { actor: 'other' }, { expectedRevision: 0 }, { priorityScore: 100 }]) assert.equal(productModelCreateInput({ ...create, ...change }), null)
})
test('cycle model selection binds cycle route and complete revisions', () => {
 const draft = { expectedRevision: 2, expectedCycleRevision: 3, modelVersion: 'customer-v2', reason: '选择周期模型' }
 assert.deepEqual(productModelSelectInput(draft, cycle), { biz_id: cycle, model_version: 'customer-v2', expected_revision: 2, expected_cycle_revision: 3, reason: '选择周期模型' })
 assert.ok(productModelSelectInput({ ...draft, modelVersion: 'weighted-value-effort-v1' }, cycle))
 for (const change of [{ biz_id: cycle }, { modelSnapshot: {} }, { expectedCycleRevision: 0 }, { authorization: {} }]) assert.equal(productModelSelectInput({ ...draft, ...change }, cycle), null)
 assert.equal(productModelSelectInput(draft, 'bad'), null)
})

test('model pagination rejects ambiguous and unauthorized query inputs', () => {
 assert.deepEqual(productModelPageInput({}), { page: 1, page_size: 20 })
 assert.deepEqual(productModelPageInput({ page: '2', pageSize: '100' }), { page: 2, page_size: 100 })
 for (const query of [{ page: '0' }, { page: '01' }, { page: ['1'] }, { page: 1 }, { pageSize: '101' }, { page: '1000001' }, { actor: 'other' }]) assert.equal(productModelPageInput(query), null)
})

test('RICE publication requires explicit comparable Reach definitions', () => {
 const draft = { expectedRevision: 1, title: '季度用户 RICE', reason: '统一口径', version: 'rice-v1', reachUnit: 'unique_users', reachDefinition: '按 UID 去重', reachStartsOn: '2026-10-01', reachEndsOn: '2026-12-31', sourceDefinition: '产品事件汇总' }
 assert.equal(productRICEModelCreateInput(draft)?.model.reach_unit, 'unique_users')
 assert.equal(productRICEModelCreateInput({ ...draft, reachUnit: 'unique_customer_organizations' })?.model.reach_unit, 'unique_customer_organizations')
 for (const patch of [{ reachUnit: 'users_or_customers' }, { reachUnit: ['unique_users'] }, { reachDefinition: '' }, { sourceDefinition: '' }, { reachStartsOn: '2026-02-30' }, { reachEndsOn: '2026-09-30' }, { reachEndsOn: '2028-12-31' }, { weights: {} }, { verified: true }, { reach: 100 }, { actor: 'other' }, { version: 'weighted-value-effort-v1' }]) assert.equal(productRICEModelCreateInput({ ...draft, ...patch }), null)
})
