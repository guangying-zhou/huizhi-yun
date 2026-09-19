import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('mounted Assets Host reads use the verified enterprise session cache namespace', () => {
  const physical = source('app/pages/physical.vue')
  const resources = source('app/pages/resources.vue')
  const assetDetail = source('app/pages/items/[id].vue')
  const digitalAssets = source('app/pages/digital-assets/index.vue')
  const digitalAssetDetail = source('app/pages/digital-assets/[id].vue')
  const cacheScope = source('layer/useAssetsModule.ts')

  assert.match(cacheScope, /useState<string>\('enterprise-cache-scope'/)
  assert.match(cacheScope, /hzy:enterprise:\$\{sessionScope\?\.value \|\| 'unverified'\}:assets:/)

  assert.match(physical, /key: cacheKey\('physical-assets'\)/)
  assert.match(resources, /key: cacheKey\('resource-assets'\)/)
  assert.match(assetDetail, /key: computed\(\(\) => cacheKey\(`asset:\$\{assetIdentifier\.value\}`\)\)/)
  assert.match(digitalAssets, /key: cacheKey\('digital-assets'\)/)
  assert.match(digitalAssetDetail, /key: computed\(\(\) => cacheKey\(`digital-asset:\$\{assetId\.value\}`\)\)/)
})
