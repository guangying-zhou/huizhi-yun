import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { computed, getCurrentInstance, onUnmounted, ref, shallowRef, unref, watch } from 'vue'
import { createDebouncedRefresh } from '../shared/debounced-refresh.mjs'

const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
const settle = () => new Promise(resolve => setImmediate(resolve))

function fakeTimers() {
  const timers = new Map()
  let next = 0
  return {
    setTimer: (callback) => {
      timers.set(++next, callback)
      return next
    },
    clearTimer: id => timers.delete(id),
    flush() {
      const pending = [...timers.values()]
      timers.clear()
      for (const callback of pending) callback()
    },
    get size() { return timers.size }
  }
}

test('a burst of change signals becomes one read, and a signal during a read queues one trailing read', async () => {
  const timers = fakeTimers()
  const runs = []
  const refresh = createDebouncedRefresh({
    run: () => new Promise(resolve => runs.push(resolve)),
    ...timers
  })
  for (let i = 0; i < 5; i++) refresh.schedule()
  assert.equal(timers.size, 1)
  timers.flush()
  await settle()
  assert.equal(runs.length, 1, 'five signals, one request')

  // More changes land while the read is in flight: exactly one trailing read.
  refresh.schedule()
  timers.flush()
  refresh.schedule()
  timers.flush()
  await settle()
  assert.equal(runs.length, 1, 'never overlapping')
  runs[0]()
  await settle()
  await settle()
  assert.equal(runs.length, 2, 'one trailing read reflects the latest state')
  runs[1]()
  await settle()
  assert.equal(runs.length, 2)

  refresh.schedule()
  refresh.dispose()
  timers.flush()
  await settle()
  assert.equal(runs.length, 2, 'disposed panels do not read')
})

test('only the registered page can bump the page-workflow business revision', () => {
  const source = read('foundation/app/composables/usePageWorkflow.ts')
  const script = stripTypeScriptTypes(source).replace(/^import .*$/gm, '').replace(/^export /gm, '')
  const load = new Function('env', `with (env) { ${script}; return { usePageWorkflow, usePageWorkflowState } }`)
  const { usePageWorkflow, usePageWorkflowState } = load({ computed, getCurrentInstance, onUnmounted, ref, shallowRef, unref, watch })
  const state = usePageWorkflowState()
  const actions = computed(() => [])
  const first = usePageWorkflow({ appCode: 'aims', resourceCode: 'tasks', bizId: ref('316'), bizTitle: ref('A'), actions })
  assert.equal(state.bizId.value, '316')
  const before = state.bizRevision.value
  first.notifyBizChanged()
  assert.equal(state.bizRevision.value, before + 1)
  const second = usePageWorkflow({ appCode: 'aims', resourceCode: 'tasks', bizId: ref('317'), bizTitle: ref('B'), actions })
  first.notifyBizChanged()
  assert.equal(state.bizRevision.value, before + 1, 'a replaced page cannot signal')
  second.notifyBizChanged()
  assert.equal(state.bizRevision.value, before + 2)
  assert.equal(state.bizId.value, '317')
})

test('the execution page signals every context re-read and the Host panel re-reads its own item', () => {
  const page = read('aims/app/pages/projects/[id]/board/[workItemId]/execution.vue')
  assert.match(page, /notifyBizChanged: notifyWorkflowBizChanged \} = usePageWorkflow\(/)
  assert.match(page, /watch\(context, \(\) => notifyWorkflowBizChanged\(\)\)/)
  // Every time-entry and deliverable write re-reads the full context.
  assert.match(page, /context\.value = nextContext/)
  const panel = read('enterprise/app/components/HostWorkflowPanel.vue')
  assert.match(panel, /createDebouncedRefresh\(\{ run: refresh, delay: 300 \}\)/)
  assert.match(panel, /watch\(\(\) => workflow\.bizRevision\.value, \(\) => \{\n\s+if \(workflow\.bizId\.value && workflow\.bizId\.value === itemId\.value\) contextRefresh\.schedule\(\)/)
  assert.match(panel, /onScopeDispose\(\(\) => contextRefresh\.dispose\(\)\)/)
})
