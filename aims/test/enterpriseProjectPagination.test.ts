import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const layerPage = (name: string) => readFileSync(new URL(`../layer/pages/${name}.vue`, import.meta.url), 'utf8')

test('Host project output and release lists request a real server page and show its total', () => {
  const output = layerPage('enterprise-project-output')
  const releases = layerPage('enterprise-project-releases')

  assert.match(output, /query: \{ project_id: projectId\.value, page: page\.value, pageSize \}/)
  assert.match(releases, /query: \{ page: page\.value, pageSize \}/)
  for (const source of [output, releases]) {
    assert.match(source, /<UPagination\s+v-model:page="page"\s+:items-per-page="pageSize"\s+:total="total"/)
    assert.match(source, /共 \{\{ total \}\} 条/)
    assert.match(source, /total\.value = result\.data\.total/)
  }
  assert.match(output, /watch\(page, refresh\)/)
  assert.match(releases, /watch\(\[projectId, project, moduleEnabled, page\], refresh/)
})
