import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

const projectRoot = resolve(import.meta.dirname, '..')

function readProjectFile(path: string) {
  return readFileSync(resolve(projectRoot, path), 'utf8')
}

function listTsFiles(dir: string): string[] {
  const absoluteDir = resolve(projectRoot, dir)
  const entries = readdirSync(absoluteDir)
  const files: string[] = []

  for (const entry of entries) {
    const absolutePath = resolve(absoluteDir, entry)
    const relativePath = `${dir}/${entry}`
    const stat = statSync(absolutePath)
    if (stat.isDirectory()) {
      files.push(...listTsFiles(relativePath))
    } else if (entry.endsWith('.ts')) {
      files.push(relativePath)
    }
  }

  return files
}

test('oauth authorize route uses the lightweight authorization helper', () => {
  const routeSource = readProjectFile('server/routes/oauth/authorize.get.ts')
  const helperSource = readProjectFile('server/utils/oidcAuthorize.ts')

  assert.match(routeSource, /server\/utils\/oidcAuthorize/)
  assert.doesNotMatch(routeSource, /server\/utils\/oidc['"]/)
  assert.doesNotMatch(helperSource, /from 'jose'|from "jose"/)
  assert.doesNotMatch(helperSource, /node:fs|node:path|node:url/)
})

test('server code does not statically import jose at runtime', () => {
  const runtimeJoseImports = listTsFiles('server')
    .flatMap(file =>
      readProjectFile(file)
        .split('\n')
        .map((line, index) => ({ file, line, index: index + 1 }))
    )
    .filter(({ line }) => /\bimport\s+(?!type\b).*from ['"]jose['"]/.test(line))
    .map(({ file, index, line }) => `${file}:${index}: ${line.trim()}`)

  assert.deepEqual(runtimeJoseImports, [])
})
