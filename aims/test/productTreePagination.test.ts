import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, compileTemplate } from 'vue/compiler-sfc'
import { productListInput } from '../server/utils/productListInput.ts'

const filename = new URL('../app/pages/products/index.vue', import.meta.url)
const source = readFileSync(filename, 'utf8')

test('product tree root, child and line chooser keep independent bounded pages', () => {
  assert.match(source, /rootPage\.value, ROOT_PAGE_SIZE/)
  assert.match(source, /choicePage\.value, CHOICE_PAGE_SIZE/)
  assert.match(source, /page, CHILD_PAGE_SIZE, \{ childLine:/)
  assert.match(source, /childRequests\.get\(key\) !== request/)
  assert.doesNotMatch(source, /MAX_FETCH_PAGES|fetchAll/)
  assert.equal(productListInput({ tree: 'true', page: '3', pageSize: '20' })?.page, 3)
  assert.equal(productListInput({ tree: 'true', childLine: '', page: '2', pageSize: '20' })?.child_line, '')
  assert.equal(productListInput({ tree: 'true', page: '1', pageSize: '101' }), null)
})

test('complete product tree page template compiles', () => {
  const { descriptor, errors } = parse(source, { filename: filename.pathname })
  assert.deepEqual(errors, [])
  assert.ok(descriptor.template)
  assert.deepEqual(compileTemplate({ filename: filename.pathname, source: descriptor.template.content, id: 'product-tree-pagination' }).errors, [])
})
