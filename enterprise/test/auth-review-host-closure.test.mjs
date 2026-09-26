import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')

test('Host asset resource modal imports its dictionary dependency explicitly', () => {
  const source = read('../../assets/app/components/assets/ProductResourceLinkModal.vue')
  assert.match(source, /import \{ useAssetDictionaries \} from '\.\.\/\.\.\/composables\/useAssetDictionaries'/)
})

test('Host product overview does not request unregistered objectives or adoption APIs', () => {
  const source = read('../../aims/app/pages/products/[productCode]/index.vue')
  assert.match(source, /hosted \? Promise\.resolve\(null\) : readCount\('\/objectives'/)
  assert.match(source, /hosted \? Promise\.resolve\(null\) : readCount\('\/roadmaps\/adoption'/)
  assert.match(source, /if \(!productCode \|\| !product\.value\) return null/)
  assert.match(source, /v-if="canEdit && !hosted"/)
})

test('Host stops old application-directory and unavailable portfolio navigation side effects', () => {
  const assetDetail = read('../../assets/app/pages/products/[id].vue')
  const projects = read('../../aims/app/pages/projects/index.vue')
  const runner = read('../../deploy/test-env/local-enterprise/run-process.mjs')
  assert.match(assetDetail, /if \(!hosted\) await loadApps\(\)/)
  assert.match(projects, /v-if="!hosted"[\s\S]*?:to="`\/portfolios\/\$\{group\.portfolio\.id\}`"/)
  assert.match(runner, /NUXT_PUBLIC_RUM_ENABLED: 'false'/)
})
