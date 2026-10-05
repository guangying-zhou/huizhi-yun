import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const layerPage = (name: string) => readFileSync(new URL(`../layer/pages/${name}.vue`, import.meta.url), 'utf8')

test('Host project output and release lists request a real server page and show its total', () => {
  const output = layerPage('enterprise-project-output')
  const releases = layerPage('enterprise-project-releases')

  assert.match(output, /moduleUrl\(`\/api\/v1\/projects\/\$\{projectId\.value\}\/output`\)/)
  assert.match(output, /query: \{ page: page\.value, pageSize \}/)
  assert.match(output, /<UPagination\s+v-model:page="page"\s+:items-per-page="pageSize"\s+:total="overview\.total"/)
  assert.match(output, /共 \{\{ overview\.total \}\} 条/)
  assert.match(output, /overview\.value = data/)
  assert.match(output, /data\.page !== page\.value/)
  assert.match(output, /data\.pageSize !== pageSize/)
  assert.match(output, /!Number\.isSafeInteger\(data\.total\)/)
  assert.match(output, /data\.stats\.total !== data\.total/)
  assert.match(releases, /query: \{ page: page\.value, pageSize \}/)
  for (const source of [releases]) {
    assert.match(source, /<UPagination\s+v-model:page="page"\s+:items-per-page="pageSize"\s+:total="total"/)
    assert.match(source, /共 \{\{ total \}\} 条/)
    assert.match(source, /total\.value = result\.data\.total/)
  }
  assert.match(output, /watch\(page, refresh\)/)
  assert.match(releases, /watch\(\[projectId, project, moduleEnabled, page\], refresh/)
})
