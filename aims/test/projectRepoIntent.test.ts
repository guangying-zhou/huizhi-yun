import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

test('repository settings and output pages compile as complete SFCs', () => {
  for (const path of ['../app/pages/projects/[id]/settings.vue', '../app/pages/projects/[id]/output.vue']) {
    const filename = new URL(path, import.meta.url).pathname
    const parsed = parse(source(path), { filename })
    assert.deepEqual(parsed.errors, [])
    const script = compileScript(parsed.descriptor, { id: filename })
    const template = compileTemplate({ filename, id: filename, source: parsed.descriptor.template!.content, compilerOptions: { bindingMetadata: script.bindings } })
    assert.deepEqual(template.errors, [])
  }
})

test('repository commands retain the user intent key until success or explicit dismissal', () => {
  const store = source('../app/stores/project.ts')
  assert.match(store, /const repoIntents = createCommandIntents\(\)/)
  assert.match(store, /method: 'POST', body: \{ repoProjectCode \}, headers: repoIntents\.headers\(action, \{ repoProjectCode \}\)/)
  assert.match(store, /method: 'DELETE', headers: repoIntents\.headers\(action\)/)
  assert.match(store, /repoIntents\.complete\(action\)/)
  for (const path of ['../app/pages/projects/[id]/settings.vue', '../app/pages/projects/[id]/output.vue']) {
    const page = source(path)
    assert.match(page, /projectStore\.abandonRepoIntent\('link'/)
    assert.match(page, /projectStore\.abandonRepoIntent\('unlink'/)
  }
})
