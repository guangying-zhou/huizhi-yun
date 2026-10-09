import test from 'node:test'
import assert from 'node:assert/strict'
import { readProjectListState, writeProjectListState } from '../app/utils/project-list-state.mjs'

test('project list state round-trips only supported query keys', () => {
  const state = readProjectListState({ category: 'delivery', search: ' alpha ', participatingOnly: 'false', view: 'list', returnTo: '/x' })
  assert.deepEqual(state, { category: 'delivery', status: 'all', portfolio: 'all', search: ' alpha ', participatingOnly: false, view: 'list' })
  assert.deepEqual(writeProjectListState(state), { category: 'delivery', search: 'alpha', participatingOnly: 'false', view: 'list' })
})

test('project list defaults omit unnecessary URL state', () => {
  assert.deepEqual(writeProjectListState({ category: 'all', status: 'all', portfolio: 'all', search: '', participatingOnly: true, view: 'card' }), {})
})
