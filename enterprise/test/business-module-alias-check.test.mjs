import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkBusinessModuleAliases, checkVuePresentationAliases, presentationFiles, serverAliasTokens } from '../scripts/check-business-module-aliases.mjs'

test('template and style alias references are rejected with source lines', () => {
  const source = `<template>\n<img src="~/image.png">\n<a href="~~/page">x</a>\n<video poster="~/poster.png"/>\n</template>\n<style>\n@import "~/bad.css";\n.box { background: url('~~/bad.png') }\n</style>`
  const result = checkVuePresentationAliases(source, 'fixture.vue')
  assert.ok(result.some(item => item.line === 2 && item.kind === 'template src'))
  assert.ok(result.some(item => item.line === 3 && item.kind === 'template href'))
  assert.ok(result.some(item => item.line === 4 && item.kind === 'template poster'))
  assert.ok(result.some(item => item.line === 7 && item.kind === 'style @import/url'))
  assert.ok(result.some(item => item.line === 8 && item.kind === 'style @import/url'))
})

test('Host server closure and business presentation aliases are clean', async () => {
  const result = await checkBusinessModuleAliases()
  assert.deepEqual(result.violations, [])
  assert.ok(result.directCount > 0)
  assert.ok(result.checkedCount >= result.directCount)
})

test('business alias scan includes module layer presentation sources', async () => {
  const { readFileSync } = await import('node:fs')
  const { resolve } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))
  const layerPage = resolve(root, 'aims/layer/pages/enterprise-project-detail.vue')
  const source = readFileSync(layerPage, 'utf8')
  assert.ok(presentationFiles('aims').includes(layerPage))
  assert.deepEqual(checkVuePresentationAliases(source, layerPage), [])
})

test('Nitro module server scan rejects both app and root aliases', () => {
  assert.equal(serverAliasTokens("import x from '~/x'; import y from '~~/y'").length, 2)
})
