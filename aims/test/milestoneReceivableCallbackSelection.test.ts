import assert from 'node:assert/strict'
import test from 'node:test'
import { selectMilestoneReceivableDispatch, selectWorkflowCallbackRuntime } from '../server/utils/milestoneReceivableCallbackSelection.ts'

test('only the enabled established milestone callback selects AA-04 Runtime scope', () => {
  assert.equal(selectWorkflowCallbackRuntime({
    enabled: true, resourceCode: 'milestones', actionCode: 'milestone_completion'
  }), 'milestone-receivable')
})

test('disabled configuration and every other callback retain the standard Runtime scope', () => {
  assert.equal(selectWorkflowCallbackRuntime({
    enabled: false, resourceCode: 'milestones', actionCode: 'milestone_completion'
  }), 'standard')
  assert.equal(selectWorkflowCallbackRuntime({
    enabled: true, resourceCode: 'projects', actionCode: 'initiation'
  }), 'standard')
})

test('callback-controlled fields cannot choose a Runtime scope', () => {
  const browserControlled = {
    enabled: false,
    resourceCode: 'milestones',
    actionCode: 'milestone_completion',
    scope: 'aims.write altoc:receivable:mark-billable'
  }
  assert.equal(selectWorkflowCallbackRuntime(browserControlled), 'standard')
})

test('a Runtime-succeeded coordinator result does not re-enter the legacy dispatcher', () => {
  assert.equal(selectMilestoneReceivableDispatch({ operationKey: 'operation-1', operationStatus: 'succeeded' }), 'already-succeeded')
  assert.equal(selectMilestoneReceivableDispatch({ operationKey: 'operation-1', operationStatus: 'pending' }), 'dispatch')
  assert.equal(selectMilestoneReceivableDispatch({ operationKey: '', operationStatus: 'succeeded' }), 'none')
})
