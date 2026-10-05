import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { resolveEnterprisePilotPath } from '../../deploy/test-env/enterprise-topology.mjs'

test('the Host 404 page offers one way back to the workbench, through Gateway-registered assets only', () => {
  const page = readFileSync(new URL('../app/error.vue', import.meta.url), 'utf8')
  assert.match(page, /clearError\(\{ redirect: '\/enterprise' \}\)/)
  assert.equal((page.match(/<UButton\b/g) || []).length, 1)
  assert.match(page, /回到工作台/)
  assert.match(page, /页面不存在/)
  // Semantic colors only; the illustration and logo resolve through the Gateway's Host asset paths.
  assert.doesNotMatch(page, /#[0-9a-fA-F]{3,8}\b/)
  assert.match(page, /const notFoundIllustration = '\/enterprise\/illustrations\/404\.svg'/)
  assert.match(page, /:src="notFoundIllustration"/)
  assert.ok(existsSync(new URL('../public/illustrations/404.svg', import.meta.url)))
  assert.deepEqual(resolveEnterprisePilotPath('/enterprise/illustrations/404.svg'), { path: '/illustrations/404.svg', kind: 'asset' })
  assert.match(page, /config\.public\.appLogo \|\| '\/enterprise\/logo\.svg'/)
  assert.deepEqual(resolveEnterprisePilotPath('/enterprise/logo.svg'), { path: '/logo.svg', kind: 'asset' })
})
