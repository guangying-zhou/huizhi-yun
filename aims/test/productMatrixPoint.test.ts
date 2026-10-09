import test from 'node:test'
import assert from 'node:assert/strict'
import { productMatrixY, validProductMatrixPoint, type ProductMatrixAssessment } from '../app/utils/productMatrixPoint'

const rice: ProductMatrixAssessment = { model_method: 'rice', value_score: null, priority_score: '90.00000000', effort_person_days: '8.00', confidence: '0.80', stale: false }
test('RICE matrix distinguishes known zero, maximum and missing values', () => {
  for (const priority_score of ['0.00000000', '90.00000000', '6000000000.00000000']) assert.equal(validProductMatrixPoint('rice', { ...rice, priority_score }), true)
  for (const priority_score of [null, '', '90', 'NaN', '-1.00000000', '6000000000.00000001']) assert.equal(validProductMatrixPoint('rice', { ...rice, priority_score }), false)
  assert.equal(productMatrixY(0, 0), 310)
  assert.equal(productMatrixY(90, 90), 50)
  assert.equal(productMatrixY(6000000000, 6000000000), 50)
})
test('matrix rejects stale, mixed methods and invalid effort or confidence', () => {
  for (const patch of [{ stale: true }, { effort_person_days: '' }, { effort_person_days: '0.49' }, { effort_person_days: '1000000.01' }, { confidence: '0.70' }, { value_score: 90 }, { model_method: 'weighted-value-effort' as const }]) assert.equal(validProductMatrixPoint('rice', { ...rice, ...patch }), false)
  assert.equal(validProductMatrixPoint('weighted-value-effort', { ...rice, model_method: 'weighted-value-effort', value_score: 80 }), true)
  assert.equal(validProductMatrixPoint('weighted-value-effort', rice), false)
})
