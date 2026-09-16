import assert from 'node:assert/strict'
import { globSync, readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

function readWorkspaceFile(path) {
  return readFileSync(resolve(rootDir, path), 'utf8')
}

describe('workspace Nuxt version alignment', () => {
  test('keeps legacy Account in the workspace but excludes it from active checks', () => {
    const workspace = readWorkspaceFile('pnpm-workspace.yaml')
    const rootManifest = JSON.parse(readWorkspaceFile('package.json'))

    assert.match(workspace, /^\s*-\s*['"]account['"]\s*$/m)
    for (const script of ['lint:active', 'typecheck:active', 'test:active']) {
      assert.match(rootManifest.scripts[script], /--filter ['"]!account['"]/, script)
    }
    assert.match(workspace, /^\s{2}nuxt:\s*4\.4\.8\s*$/m)
    assert.match(workspace, /^\s{2}['"]@nuxt\/schema['"]:\s*4\.4\.8\s*$/m)
  })

  test('keeps every Nuxt consumer in the active workspace on 4.4.8', () => {
    const workspace = readWorkspaceFile('pnpm-workspace.yaml')
    const patterns = [...workspace.matchAll(/^\s*-\s*['"]([^'"]+)['"]\s*$/gm)]
      .map(match => `${match[1]}/package.json`)
    const packageFiles = patterns.flatMap(pattern => globSync(pattern, { cwd: rootDir }))

    for (const packageFile of packageFiles.filter(path => path !== 'account/package.json')) {
      const manifest = JSON.parse(readWorkspaceFile(packageFile))
      for (const section of ['dependencies', 'devDependencies', 'peerDependencies']) {
        const nuxtVersion = manifest[section]?.nuxt
        if (nuxtVersion) {
          assert.equal(nuxtVersion, '~4.4.8', `${packageFile} ${section}.nuxt`)
        }
      }
    }
  })

  test('lockfile resolves Nuxt and Schema exclusively to 4.4.8', () => {
    const lockfile = readWorkspaceFile('pnpm-lock.yaml')
    const nuxtVersions = [...lockfile.matchAll(/(?:^|\s)nuxt@(\d+\.\d+\.\d+)/gm)]
      .map(match => match[1])
    const schemaVersions = [...lockfile.matchAll(/@nuxt\/schema@(\d+\.\d+\.\d+)/g)]
      .map(match => match[1])

    assert.deepEqual([...new Set(nuxtVersions)], ['4.4.8'])
    assert.deepEqual([...new Set(schemaVersions)], ['4.4.8'])
  })
})
