import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import { observeHostPageTitle } from '../app/utils/host-page-title.ts'

function observerFixture() {
  const original = { IntersectionObserver: globalThis.IntersectionObserver, MutationObserver: globalThis.MutationObserver }
  let intersection, mutations
  globalThis.IntersectionObserver = class {
    targets = new Set()
    constructor(callback, options) {
      this.callback = callback
      this.options = options
      intersection = this
    }

    observe(target) { this.targets.add(target) }
    unobserve(target) { this.targets.delete(target) }
    disconnect() {
      this.targets.clear()
      this.disconnected = true
    }
  }
  globalThis.MutationObserver = class {
    constructor(callback) {
      this.callback = callback
      mutations = this
    }

    observe(root, options) {
      this.root = root
      this.options = options
    }

    disconnect() { this.disconnected = true }
  }
  const heading = { textContent: '合同' }
  const root = { heading, querySelector(selector) {
    assert.equal(selector, '[data-host-page-title]')
    return this.heading
  }, getBoundingClientRect: () => ({ top: 56 }) }
  const states = []
  const stop = observeHostPageTitle(root, state => states.push(state))
  const signal = (target, bottom, isIntersecting = false, height = 28) => intersection.callback([{ target, boundingClientRect: { bottom, height }, isIntersecting, rootBounds: { top: 56 } }])
  return { root, heading, states, intersection, mutations, signal, stop, restore() {
    stop()
    for (const [name, value] of Object.entries(original)) {
      if (value === undefined) delete globalThis[name]
      else globalThis[name] = value
    }
  } }
}

test('pinned title appears only after shared heading scrolls above main, then hides on return', () => {
  const f = observerFixture()
  try {
    assert.equal(f.intersection.options.root, f.root)
    assert.equal(f.intersection.options.threshold, 0)
    assert.deepEqual(f.states.at(-1), { title: '合同', visible: false })
    f.signal(f.heading, 108, true)
    assert.equal(f.states.at(-1).visible, false)
    f.signal(f.heading, 56)
    assert.deepEqual(f.states.at(-1), { title: '合同', visible: true })
    f.signal(f.heading, 80, true)
    assert.equal(f.states.at(-1).visible, false)
    f.signal(f.heading, 1200)
    assert.equal(f.states.at(-1).visible, false, 'below viewport is not scrolled past')
    f.signal(f.heading, 0, false, 0)
    assert.equal(f.states.at(-1).visible, false, 'hidden heading is not a title')
  } finally { f.restore() }
})

test('reactive names, route replacement, no-header pages and unmount cannot retain a stale title', () => {
  const f = observerFixture()
  try {
    f.signal(f.heading, 20)
    f.heading.textContent = '合同 · 合成客户'
    f.mutations.callback([])
    assert.deepEqual(f.states.at(-1), { title: '合同 · 合成客户', visible: true })
    const count = f.states.length
    f.mutations.callback([])
    assert.equal(f.states.length, count, 'unrelated table mutation must not rerender the header')
    const next = { textContent: '项目管理' }
    f.root.heading = next
    f.mutations.callback([])
    assert.equal(f.intersection.targets.has(f.heading), false)
    assert.equal(f.intersection.targets.has(next), true)
    f.signal(f.heading, 20)
    assert.deepEqual(f.states.at(-1), { title: '项目管理', visible: false })
    f.signal(next, 20)
    assert.equal(f.states.at(-1).visible, true)
    f.root.heading = null
    f.mutations.callback([])
    assert.deepEqual(f.states.at(-1), { title: '', visible: false })
    f.stop()
    assert.equal(f.intersection.disconnected, true)
    assert.equal(f.mutations.disconnected, true)
    f.root.heading = next
    f.mutations.callback([])
    f.signal(next, 20)
    assert.deepEqual(f.states.at(-1), { title: '', visible: false })
  } finally { f.restore() }
})

test('SSR/unsupported browsers stay empty without reading browser globals', () => {
  assert.equal(typeof globalThis.IntersectionObserver, 'undefined')
  const states = []
  observeHostPageTitle({ querySelector() {
    throw Error('should not query')
  } }, state => states.push(state))()
  assert.deepEqual(states, [{ title: '', visible: false }])
})

test('shared Host shell uses one sidebar width, responsive brand and right-side environment; complete SFC compiles', () => {
  const source = readFileSync(new URL('../app/layouts/default.vue', import.meta.url), 'utf8')
  const { descriptor, errors } = parse(source)
  assert.deepEqual(errors, [])
  assert.ok(compileScript(descriptor, { id: 'host-layout', inlineTemplate: true }).content)
  assert.match(source, /collapsed.value \? 56 : width.value/)
  assert.match(source, /'--host-sidebar-width': sidebarWidth/)
  assert.match(source, /'--host-displayed-sidebar-width': displayedSidebarWidth/)
  assert.match(source, /lg:w-\[var\(--host-sidebar-width\)\]/)
  assert.match(source, /:style="\{ width: sidebarWidth \}"/)
  assert.match(source, /<main\s+ref="contentViewport"/)
  assert.match(source, /observeHostPageTitle\(contentViewport.value/)
  assert.match(source, /onBeforeUnmount\(\(\) => stopTitleObserver\?\.\(\)\)/)
  const brand = source.slice(source.indexOf('<NuxtLink'), source.indexOf('data-host-topbar-actions'))
  assert.match(brand, /hidden.*lg:inline/)
  assert.match(brand, /border-r border-\[var\(--host-nav-border\)\]/)
  assert.match(brand, /lg:w-\[var\(--host-displayed-sidebar-width\)\]/)
  assert.match(source, /data-host-sidebar-panel/)
  assert.match(source, /absolute inset-y-0 left-0 z-30 shadow-lg/)
  assert.match(source, /@focusin="focusSidebar"/)
  assert.match(source, /@focusout="blurSidebar"/)
  assert.match(source, /hover: hover.*pointer: fine/)
  assert.match(source, /@click="collapsed = !collapsed"/)
  assert.doesNotMatch(brand, /nonProduction/)
  const actions = source.slice(source.indexOf('data-host-topbar-actions'), source.indexOf('</header>'))
  assert.match(actions, /data-host-environment/)
  assert.ok(actions.indexOf('data-host-environment') < actions.indexOf('<UDropdownMenu'))
  assert.match(brand, /data-host-pinned-title/)
  assert.match(brand, /truncate.*transition-opacity.*motion-reduce:transition-none/)
  assert.match(source, /aria-label="返回文档"/)
})
