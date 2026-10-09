import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { ref } from 'vue'
import { useReadonlyEditorOverlay } from '../app/components/editor/useReadonlyEditorOverlay'

test('readonly watermark covers long documents and follows resize without affecting content', () => {
  let height = 24000
  let resized: (() => void) | undefined
  let disconnected = false
  const previous = { window: globalThis.window, ResizeObserver: globalThis.ResizeObserver, MutationObserver: globalThis.MutationObserver }
  Object.assign(globalThis, {
    window: { requestAnimationFrame: (callback: () => void) => {
      callback()
      return 1
    }, cancelAnimationFrame: () => {} },
    ResizeObserver: class {
      constructor(callback: () => void) { resized = callback }
      observe() {} disconnect() { disconnected = true }
    },
    MutationObserver: class { observe() {} disconnect() {} }
  })
  try {
    const wrapper = { getBoundingClientRect: () => ({ width: 720, height }) }
    const editor = { closest: () => wrapper, querySelectorAll: () => [] } as unknown as HTMLDivElement
    const overlay = useReadonlyEditorOverlay({ editorRef: ref(editor), readonly: ref(true), viewMode: ref('edit'), watermarkText: ref('合成查看者'), isEditorDestroying: ref(false), toast: { add() {} } })
    overlay.setupReadonlyCodeBlockObserver()
    assert.equal(overlay.readonlyWatermarkText.value, '合成查看者')
    assert.equal(overlay.readonlyWatermarkCount.value, 2 * Math.ceil(height / 180))
    height = 48000
    resized?.()
    assert.equal(overlay.readonlyWatermarkCount.value, 2 * Math.ceil(height / 180))
    overlay.teardownReadonlyCodeBlockObserver()
    assert.equal(disconnected, true)
  } finally { Object.assign(globalThis, previous) }
})

test('watermark anchors at document origin and rotates labels rather than the long grid', () => {
  const source = readFileSync(new URL('../app/components/editor/MilkdownEditor.client.vue', import.meta.url), 'utf8')
  const grid = source.match(/\.readonly-watermark-grid \{([^}]+)\}/)?.[1] || ''
  assert.match(grid, /inset: 0/)
  assert.doesNotMatch(grid, /rotate|50%/)
  assert.match(source, /v-for="n in readonlyWatermarkCount"/)
  assert.match(source, /\.readonly-watermark-grid > span \{[^}]+rotate\(-24deg\)/)
})
