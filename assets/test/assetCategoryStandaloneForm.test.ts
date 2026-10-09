import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'

function check(path: string) {
  const filename = new URL(path, import.meta.url).pathname
  const { descriptor, errors } = parse(readFileSync(filename, 'utf8'), { filename })
  assert.deepEqual(errors, [])
  const script = compileScript(descriptor, { id: filename })
  const template = compileTemplate({ filename, id: filename, source: descriptor.template!.content, compilerOptions: { bindingMetadata: script.bindings } })
  assert.deepEqual(template.errors, [])
  return descriptor
}

test('category list, shared form and Host standalone page compile as complete SFCs', () => {
  for (const path of ['../app/pages/admin/asset-categories.vue', '../app/components/assets/AssetCategoryEditModal.vue', '../layer/pages/asset-category-form.vue']) check(path)
})

test('Host category and item editing reuse the original request and leave guard; standalone Assets keeps modal', () => {
  const list = check('../app/pages/admin/asset-categories.vue').scriptSetup!.content
  assert.match(list, /if \(hosted\) return void navigateTo\(moduleUrl\(`\/admin\/asset-categories\/new/)
  assert.match(list, /mode=category&returnTo=/)
  assert.match(list, /mode=items&returnTo=/)
  const form = check('../app/components/assets/AssetCategoryEditModal.vue')
  assert.match(form.scriptSetup!.content, /submissionKey\.value \|\|= crypto\.randomUUID\(\)/)
  assert.match(form.scriptSetup!.content, /surface\.value\?\.markSaved\(\)/)
  assert.match(form.template!.content, /<AssetFormSurface[\s\S]*:page="props\.page"[\s\S]*:draft="JSON\.stringify\(state\)"/)
  const page = check('../layer/pages/asset-category-form.vue')
  assert.match(page.scriptSetup!.content, /normalizeAssetCategoryGroups\(data\.value\?\.data\.items, 'product'\)/)
  assert.match(page.template!.content, /:mode="editing \? mode : 'create'"/)
})
