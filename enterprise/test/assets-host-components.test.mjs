import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const repo = fileURLToPath(new URL('../../', import.meta.url))
const config = readFileSync(new URL('../nuxt.config.ts', import.meta.url), 'utf8')

test('Enterprise registers every component used by hosted digital and IP asset pages', () => {
  const registration = config.match(/path: fileURLToPath\(new URL\('\.\.\/assets\/app\/components\/assets'[^]*?pattern: '\{([^']+)\}\.vue',\s*prefix: 'Assets', pathPrefix: false/)
  assert.ok(registration, 'Assets components must have an explicit Enterprise registration')
  const registered = new Set(registration[1].split(','))
  const pages = ['digital-assets/index.vue', 'digital-assets/[id].vue', 'ip-assets/index.vue', 'ip-assets/[id].vue']
  for (const page of pages) {
    const source = readFileSync(`${repo}assets/app/pages/${page}`, 'utf8')
    for (const [, tag] of source.matchAll(/<(Assets[A-Z][A-Za-z0-9]*)\b/g)) {
      const filename = `${tag.slice('Assets'.length)}.vue`
      assert.ok(registered.has(filename.slice(0, -4)), `${page} uses an unregistered ${tag}`)
      assert.ok(existsSync(`${repo}assets/app/components/assets/${filename}`), `${tag} source is missing`)
    }
  }
})
