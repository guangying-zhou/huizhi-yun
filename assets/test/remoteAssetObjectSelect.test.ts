import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'

const read = (name: string) => readFileSync(new URL(`../app/components/assets/${name}.vue`, import.meta.url), 'utf8')
test('asset/product/environment link pickers share popup-contained choices and retain the original write command', () => {
  const names = ['RemoteAssetObjectSelect', 'IpAssetProductLinkModal', 'DigitalAssetProductLinkModal', 'DeliveryProductLinkModal', 'ProductBaseLinkModal', 'ProductResourceLinkModal', 'DeliveryEnvironmentLinkModal', 'EnvironmentAssetBindModal']
  for (const name of names) {
    const source = read(name)
    const { descriptor, errors } = parse(source)
    assert.deepEqual(errors, [], name)
    const script = compileScript(descriptor, { id: name })
    assert.deepEqual(compileTemplate({ source: descriptor.template!.content, filename: name, id: name, compilerOptions: { bindingMetadata: script.bindings } }).errors, [], name)
    if (name !== 'RemoteAssetObjectSelect') {
      assert.match(source, /import RemoteAssetObjectSelect/)
      assert.match(source, /:exclude-ids=/)
      assert.match(source, /method: 'POST'/)
      assert.doesNotMatch(source, /<USelectMenu|UPagination|async function load(?:Products|Assets|Bases|Environments)/)
    }
  }
  const selector = read('RemoteAssetObjectSelect')
  assert.match(selector, /hosted && props.kind === 'products'/)
  assert.match(selector, /paged.value \? \{ query:/, 'only genuinely paged API receives page/search parameters')
  assert.match(selector, /\/api\/v1\/products\/link-candidates\/bases/)
  assert.match(selector, /\/api\/v1\/products\/link-candidates\/assets/)
  assert.match(selector, /props.excludeIds.includes/)
  assert.match(selector, /current !== epoch/)
})
