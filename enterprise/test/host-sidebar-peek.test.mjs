import test from 'node:test'
import assert from 'node:assert/strict'
import { createHostSidebarPeek } from '../app/utils/host-sidebar-peek.ts'

function fixture(t, initial = {}) {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const state = { collapsed: true, desktop: true, hover: true, expanded: false, ...initial }
  const peek = createHostSidebarPeek({ collapsed: () => state.collapsed, desktop: () => state.desktop, hover: () => state.hover, update: (value) => {
    state.expanded = value
  } })
  t.after(() => peek.stop())
  return { state, peek, tick: ms => t.mock.timers.tick(ms) }
}

test('mouse disclosure delays entry/exit, cancels jitter and never changes collapsed preference', (t) => {
  const { state, peek, tick } = fixture(t)
  peek.pointerEnter('mouse')
  tick(159)
  assert.equal(state.expanded, false)
  tick(1)
  assert.equal(state.expanded, true)
  assert.equal(state.collapsed, true)
  peek.pointerLeave()
  tick(150)
  peek.pointerEnter('mouse')
  tick(200)
  assert.equal(state.expanded, true)
  peek.pointerLeave()
  tick(219)
  assert.equal(state.expanded, true)
  tick(1)
  assert.equal(state.expanded, false)
  peek.pointerEnter('mouse')
  tick(50)
  peek.pointerLeave()
  tick(300)
  assert.equal(state.expanded, false)
  assert.equal(state.collapsed, true)
})

test('keyboard focus expands immediately, stays while focused and closes after leaving', (t) => {
  const { state, peek, tick } = fixture(t)
  peek.focus()
  assert.equal(state.expanded, true)
  peek.pointerLeave()
  tick(500)
  assert.equal(state.expanded, true)
  peek.blur()
  tick(220)
  assert.equal(state.expanded, false)
  assert.equal(state.collapsed, true)
})

test('touch, small viewport and expanded preference never activate mouse disclosure', (t) => {
  const { state, peek, tick } = fixture(t)
  for (const type of ['touch', 'pen']) {
    peek.pointerEnter(type)
    tick(200)
    assert.equal(state.expanded, false)
  }
  state.hover = false
  peek.pointerEnter('mouse')
  tick(200)
  assert.equal(state.expanded, false)
  state.desktop = false
  peek.focus()
  assert.equal(state.expanded, false)
  state.desktop = true
  state.hover = true
  state.collapsed = false
  peek.pointerEnter('mouse')
  peek.focus()
  tick(200)
  assert.equal(state.expanded, false)
})

test('breakpoint/preference reset and unmount cancel pending disclosure', (t) => {
  const { state, peek, tick } = fixture(t)
  peek.pointerEnter('mouse')
  peek.reset()
  tick(500)
  assert.equal(state.expanded, false)
  peek.focus()
  peek.stop()
  tick(500)
  assert.equal(state.expanded, false)
  peek.pointerEnter('mouse')
  peek.focus()
  tick(500)
  assert.equal(state.expanded, false)
})
