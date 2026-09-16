import assert from 'node:assert/strict'
import test from 'node:test'

import {
  affectedGoModules,
  affectedWorkspacePackageNames,
  isUsableDiffBase,
  requiresFullWorkspaceCheck
} from '../lib/affected-checks.mjs'

const workspaces = [
  { name: '@hzy/foundation', path: 'foundation' },
  { name: '@hzy/platform-sdk', path: 'foundation/packages/platform-sdk' },
  { name: 'account', path: 'account' },
  { name: 'platform', path: 'platform' },
  { name: '@hzy/authz-core', path: 'platform/packages/authz-core' },
  { name: 'people', path: 'people' },
  { name: 'insights', path: 'insights' }
]

test('selects only the active workspace owning a module change', () => {
  assert.deepEqual(
    affectedWorkspacePackageNames(['people/server/api/employees.get.ts'], workspaces),
    ['people']
  )
})

test('selects the nearest nested workspace and lets pnpm expand its dependents', () => {
  assert.deepEqual(
    affectedWorkspacePackageNames(['platform/packages/authz-core/src/index.ts'], workspaces),
    ['@hzy/authz-core']
  )
})

test('keeps legacy account and documentation-only changes out of active checks', () => {
  assert.deepEqual(
    affectedWorkspacePackageNames(['account/pages/index.vue', 'docs/runbook.md'], workspaces),
    []
  )
})

test('falls back to every active package when a changed active path has no owner', () => {
  assert.deepEqual(
    affectedWorkspacePackageNames(['collab/package.json'], workspaces),
    ['@hzy/foundation', '@hzy/platform-sdk', 'insights', 'people', 'platform', '@hzy/authz-core']
  )
})

test('shared package toolchain changes select every active workspace', () => {
  assert.equal(requiresFullWorkspaceCheck(['pnpm-lock.yaml']), true)
  assert.deepEqual(
    affectedWorkspacePackageNames(['pnpm-lock.yaml'], workspaces),
    ['@hzy/foundation', '@hzy/platform-sdk', 'insights', 'people', 'platform', '@hzy/authz-core']
  )
})

test('CI orchestration changes rely on selector tests without widening source impact', () => {
  assert.equal(requiresFullWorkspaceCheck(['.gitlab-ci.yml']), false)
  assert.deepEqual(affectedWorkspacePackageNames(['.gitlab-ci.yml'], workspaces), [])
})

test('Go tests are selected by module unless a full fallback is required', () => {
  assert.deepEqual(affectedGoModules(['notification-runtime/internal/worker.go']), ['notification-runtime'])
  assert.deepEqual(affectedGoModules(['pnpm-lock.yaml']), [])
  assert.deepEqual(
    affectedGoModules(['docs/runbook.md'], { forceFull: true }),
    ['data-runtime', 'notification-runtime', 'dev-agent']
  )
})

test('rejects missing and all-zero Git diff bases', () => {
  assert.equal(isUsableDiffBase(''), false)
  assert.equal(isUsableDiffBase('0000000000000000000000000000000000000000'), false)
  assert.equal(isUsableDiffBase('b206f2d1'), true)
})
