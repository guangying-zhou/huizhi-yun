import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { composeManifest } from './manifest-artifacts.mjs'
const read = path => JSON.parse(readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8'))
const manifest = composeManifest([read('../../aims/app.manifest.json'), read('../../assets/app.manifest.json'), read('../../codocs/app.manifest.json')])
const output = fileURLToPath(new URL('../app.manifest.json', import.meta.url))
const content = JSON.stringify(manifest, null, 2) + '\n'
if (process.argv.includes('--check')) {
  if (readFileSync(output, 'utf8') !== content) throw Error('Enterprise manifest is stale; regenerate from source manifests')
} else writeFileSync(output, content)
console.log(`permissionCatalogHash=${manifest.composition.permissionCatalogHash}`)
