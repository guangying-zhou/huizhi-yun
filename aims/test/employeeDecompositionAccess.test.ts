import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'

test('decomposition uses the explicit existing edit action and guards submission after permission changes', () => {
  const source = readFileSync(new URL('../app/pages/projects/[id]/work-items/[workItemId]/decompose.vue', import.meta.url), 'utf8')
  assert.match(source, /hasPermission\('work_items', 'edit'\)/)
  assert.match(source, /canEditDecomposition.value && summary.value.items.length/)
  assert.match(source, /if \(!canEditDecomposition.value \|\| submitting.value \|\| !context.value\) return/)
  assert.match(source, /v-if="canEditDecomposition"[^>]*@click="openSubmitDialog"/)
  assert.match(source, /当前账号没有工作项编辑权限，仅可查看/)
  assert.match(source, /import ContentPageHeader from/)
  assert.match(source, /<ContentPageHeader :hosted="hosted"/)
  assert.match(source, /flex-col @4xl:flex-row/)
  assert.match(source, /hostContentInset: false/)
  const { descriptor, errors } = parse(source)
  assert.deepEqual(errors, [])
  assert.ok(compileScript(descriptor, { id: 'employee-decomposition', inlineTemplate: true }).content)
})
