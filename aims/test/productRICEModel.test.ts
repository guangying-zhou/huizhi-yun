import { test } from 'node:test'
import assert from 'node:assert/strict'
import { supportedRICECycleModel as supported } from '../app/utils/productRICEModel'

const model = { version: 'rice-v1', effort_unit: 'person_day', minimum_effort_person_days: '0.50', priority_decimal_places: 8, rounding: 'half_up', impact_values: ['0.25', '0.50', '1.00', '2.00', '3.00'], confidence_values: ['0.50', '0.80', '1.00'], reach_unit: 'unique_users', reach_definition: '窗口内去重用户', source_definition: '使用记录', reach_starts_on: '2026-01-01', reach_ends_on: '2026-12-31' }
test('RICE presentation accepts the frozen person-day model and both distinct Reach units', () => {
  assert.equal(supported('rice-v1', model), true)
  assert.equal(supported('rice-v1', { ...model, reach_unit: 'unique_customer_organizations' }), true)
  assert.equal(supported('other', model), false)
  assert.equal(supported('weighted-value-effort-v1', { ...model, version: 'weighted-value-effort-v1' }), false)
})
test('RICE presentation rejects incomplete or incompatible calculation and evidence definitions', () => {
  for (const patch of [{ effort_unit: 'person_month' }, { minimum_effort_person_days: '0' }, { priority_decimal_places: 2 }, { rounding: 'floor' }, { impact_values: [0.25, 0.5, 1, 2, 3] }, { confidence_values: ['0.50', '1.00'] }, { reach_unit: 'mixed' }, { reach_definition: '' }, { source_definition: '\uD800' }, { reach_starts_on: '2026-02-30' }, { reach_ends_on: '2025-12-31' }, { reach_ends_on: '2027-01-03' }]) assert.equal(supported('rice-v1', { ...model, ...patch }), false)
  for (const key of Object.keys(model)) {
    const partial = Object.fromEntries(Object.entries(model).filter(([field]) => field !== key))
    assert.equal(supported('rice-v1', partial), false, key)
  }
})
