import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  requirementTargetFilterValue,
  requirementTargetIdFromRouteQuery,
  resolveRequirementTargetId
} from '../app/utils/requirementsTargetSelection.ts'

const targets = [
  { id: 11, milestoneId: 1 },
  { id: 22, milestoneId: 2 },
  { id: 33, milestoneId: null }
]

describe('requirement target selection', () => {
  test('retains a valid workItemId supplied by the URL', () => {
    const initialTargetId = requirementTargetIdFromRouteQuery('22')

    assert.equal(resolveRequirementTargetId(initialTargetId, targets, 1), 22)
    assert.equal(requirementTargetFilterValue(initialTargetId), '22')
  })

  test('falls back to the active milestone target, then the first target', () => {
    assert.equal(resolveRequirementTargetId(999, targets, 2), 22)
    assert.equal(resolveRequirementTargetId(999, targets, 999), 11)
  })

  test('clears an unavailable target filter when there are no targets', () => {
    const selectedTargetId = resolveRequirementTargetId(999, [], 2)

    assert.equal(selectedTargetId, null)
    assert.equal(requirementTargetFilterValue(selectedTargetId), '')
  })

  test('uses an empty filter value for the all-requirements selection', () => {
    assert.equal(requirementTargetFilterValue(null), '')
  })

  test('keeps no target selected when the project has no targets', () => {
    assert.equal(resolveRequirementTargetId(null, [], 1), null)
  })
})
