import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { businessModuleAliasPlugin, resolveBusinessModuleAlias } from '../composition/business-module-alias.mjs'

const root = resolve(import.meta.dirname, '../..')

test('composed module aliases stay relative to their owning app in build and dev', async () => {
  const importer = resolve(root, 'aims/app/pages/products/[productCode]/adoption.vue')
  const plugin = businessModuleAliasPlugin()
  const source = readFileSync(importer, 'utf8')
  const transformed = await plugin.transform(source, importer)
  assert.ok(transformed)
  assert.match(transformed.code, /aims\/app\/utils\/productReadLabels/)
  assert.match(transformed.code, /aims\/app\/types\/productAdoption/)
  assert.doesNotMatch(transformed.code, /enterprise\/app\/utils\/productReadLabels/)
  assert.equal(resolveBusinessModuleAlias('~/utils/productReadLabels', resolve(root, 'enterprise/app/pages/index.vue')), null)
})

test('only import specifier spans change; comments and string constants remain intact', async () => {
  const importer = resolve(root, 'aims/app/pages/products/[productCode]/adoption.vue')
  const source = `<script setup>\n// import '~/comment'\nconst note = "~/literal"\nimport { productAdoptionRoles } from '~/utils/productReadLabels'\n</script>`
  const transformed = await businessModuleAliasPlugin().transform(source, importer)
  assert.match(transformed.code, /\/\/ import '~\/comment'/)
  assert.match(transformed.code, /const note = "~\/literal"/)
  assert.match(transformed.code, /from '\/.*aims\/app\/utils\/productReadLabels'/)
})

test('computed dynamic imports fail closed', async () => {
  const importer = resolve(root, 'aims/app/pages/products/[productCode]/adoption.vue')
  await assert.rejects(() => businessModuleAliasPlugin().transform('<script setup>const m = import(`~/utils/${name}`)</script>', importer), /Non-literal dynamic import/)
})

test('Vue virtual script and macro requests are treated as JavaScript', async () => {
  const importer = resolve(root, 'aims/app/pages/products/[productCode]/adoption.vue')
  const result = await businessModuleAliasPlugin().transform('import { productAdoptionRoles } from \'~/utils/productReadLabels\'', `${importer}?macro=true&vue&type=script&setup=true&lang.ts`)
  assert.match(result.code, /aims\/app\/utils\/productReadLabels/)
  const macro = await businessModuleAliasPlugin().transform('<script setup>import { productAdoptionRoles } from \'~/utils/productReadLabels\'</script>', `${importer}?macro=true`)
  assert.match(macro.code, /aims\/app\/utils\/productReadLabels/)
})

test('missing or escaping module aliases fail before Nuxt global alias can capture them', () => {
  const importer = resolve(root, 'aims/app/pages/products/[productCode]/adoption.vue')
  assert.throws(() => resolveBusinessModuleAlias('~/utils/missingReleaseModule', importer), /Unresolved aims module import/)
  assert.throws(() => resolveBusinessModuleAlias('~/../../enterprise/private', importer), /Invalid aims module import/)
})

test('composed page metadata is extracted separately and never runs in the component', async () => {
  const importer = resolve(root, 'codocs/app/pages/mydocs/shared.vue')
  const source = '<script setup lang="ts">\ndefinePageMeta({ hostContentInset: false })\nconst label = "definePageMeta()"\n</script>'
  const runtime = await businessModuleAliasPlugin().transform(source, importer)
  assert.doesNotMatch(runtime.code, /definePageMeta\(\{/)
  assert.match(runtime.code, /const label = "definePageMeta\(\)"/)
  const macro = await businessModuleAliasPlugin().transform(source, `${importer}?macro=true`)
  assert.match(macro?.code || source, /definePageMeta\(\{ hostContentInset: false \}\)/)
})

test('manual-refresh Host prevents late dependency rediscovery from splitting Vue contexts', () => {
  const config = readFileSync(resolve(root, 'enterprise/nuxt.config.ts'), 'utf8')
  assert.match(config, /config\.optimizeDeps\.noDiscovery = true/)
})
