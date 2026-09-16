import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import assert from 'node:assert/strict'

test('Finance user directory BFF preserves the current session for Console authorization', () => {
  const routePath = fileURLToPath(new URL('../server/api/directory/users/[uid].get.ts', import.meta.url))
  const route = readFileSync(routePath, 'utf8')

  assert.match(route, /fetchConsoleDirectoryApi\(`\/users\/\$\{encodeURIComponent\(uid\)\}`, \{ event \}\)/)
})

test('Finance Cloudflare deployment documents the Tenant Gateway trust secret', () => {
  const readmePath = fileURLToPath(new URL('../deploy/cloudflare/README.md', import.meta.url))
  const readme = readFileSync(readmePath, 'utf8')

  assert.match(readme, /HZY_CLOUDFLARE_INTERNAL_TOKEN/)
  assert.match(readme, /token:cloudflare-internal[\s\S]*--target finance/)
})
