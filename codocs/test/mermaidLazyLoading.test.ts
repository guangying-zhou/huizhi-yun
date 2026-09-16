import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('Codocs shares one lazy Mermaid loader without static runtime imports', () => {
  const loader = read('app/utils/mermaidLoader.ts')
  const editor = read('app/components/editor/editorMermaid.ts')
  const milkdown = read('app/components/editor/MilkdownEditor.client.vue')
  const review = read('app/components/review/ReviewFlowChart.vue')

  for (const source of [editor, milkdown, review]) {
    assert.doesNotMatch(source, /import mermaid from ['"]mermaid['"]/)
  }
  assert.match(loader, /mermaidPromise \|\|= import\('mermaid'\)/)
  assert.match(loader, /let operationQueue: Promise<void> = Promise\.resolve\(\)/)
  assert.match(loader, /api\.initialize\(config\)/)
  assert.match(editor, /renderMermaid\(editorMermaidConfig, svgId, content\)/)
  assert.match(review, /renderMermaid\(mermaidConfig, chartId, mermaidCode\)/)
})
