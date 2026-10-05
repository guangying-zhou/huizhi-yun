import test from 'node:test'
import { productModelVersion } from '../server/utils/productModelInput'
import assert from 'node:assert/strict'
import { supportedWeightedCycleModel, validProductModelVersion } from '../app/utils/productWeightedModel'
const builtin = { version: 'weighted-value-effort-v1', weights: { strategic: 30, user_value: 30, business: 20, risk: 20 }, effort_unit: 'person_day', confidence_values: ['0.50', '0.80', '1.00'], minimum_effort_person_days: '0.50' }
const custom = { ...builtin, version: 'customer-v2', weights: { strategic: 10, user_value: 60, business: 20, risk: 10 }, dimension_scale: 'integer_0_to_5', value_scale: 100, priority_decimal_places: 8, rounding: 'half_up' }
test('assessment form supports frozen built-in and custom weighted models', () => {
  assert.equal(supportedWeightedCycleModel(builtin.version, builtin), true)
  assert.equal(supportedWeightedCycleModel(custom.version, custom), true)
  assert.equal(supportedWeightedCycleModel('different', custom), false)
  assert.equal(supportedWeightedCycleModel(builtin.version, { ...builtin, weights: custom.weights }), false)
})
test('unsupported or incomplete rules cannot open the weighted assessment form', () => {
  for (const snapshot of [null, {}, { ...custom, weights: { strategic: 100 } }, { ...custom, effort_unit: 'hours' }, { ...custom, value_scale: 5 }, { ...custom, priority_decimal_places: 2 }, { ...custom, rounding: 'floor' }, { ...custom, confidence_values: ['1.00'] }, { version: 'rice-v1', reach: 100, impact: 3 }]) assert.equal(supportedWeightedCycleModel(custom.version, snapshot), false)
})

test('browser version validation agrees with API identifiers including Unicode boundaries', () => {
  for (const version of ['customer-v2', '用户价值-v2', '模'.repeat(64), '😀'.repeat(64)]) { assert.equal(validProductModelVersion(version), true); assert.equal(validProductModelVersion(version), productModelVersion(version)) }
  for (const version of ['', ' v2', 'v2 ', 'v2/other', 'v2\n', 'v2\u007f', '\ud800', '模'.repeat(65), null]) { assert.equal(validProductModelVersion(version), false); assert.equal(validProductModelVersion(version), productModelVersion(version)) }
})
