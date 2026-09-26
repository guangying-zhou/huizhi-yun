#!/usr/bin/env node
// Run the real v1 target / v2 matter acceptance tests at every command boundary.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import test from 'node:test'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const boundaries = [
  {
    name: 'Aims executor',
    args: ['--dir', 'aims', 'exec', 'tsx', '--test', 'test/workItemCompletionOperationExecutor.test.ts'],
    expected: []
  },
  {
    name: 'Workflow BFF',
    args: ['--dir', 'workflow', 'exec', 'tsx', '--test', 'test/aimsCompletionServiceBoundary.test.ts'],
    expected: []
  },
  {
    name: 'Runtime leased succeed/fail and callback',
    command: 'go',
    cwd: resolve(root, 'data-runtime'),
    args: ['test', './internal/apps/aims', '-run', 'TestCompletionSchemaContract|TestWorkItemCompletionCallbackRejectsTrustAndEvidenceDrift', '-count=1', '-v'],
    expected: ['TestCompletionSchemaContractRuntimeLeaseAcceptsOnlyTargetV1AndMatterV2', 'TestCompletionSchemaContractRuntimeSucceedAndFailUseFrozenLeaseSchema', 'TestWorkItemCompletionCallbackRejectsTrustAndEvidenceDrift']
  },
  {
    name: 'Workflow receipt',
    command: 'go',
    cwd: resolve(root, 'data-runtime'),
    args: ['test', './internal/apps/workflow', '-run', 'TestAimsCompletionReceiptSchemaContract', '-count=1', '-v'],
    expected: ['TestAimsCompletionReceiptSchemaContract']
  }
]

for (const boundary of boundaries) {
  test(boundary.name, () => {
    const result = spawnSync(boundary.command || 'pnpm', boundary.args, {
      cwd: boundary.cwd || root, encoding: 'utf8', timeout: 120_000, maxBuffer: 4 * 1024 * 1024
    })
    assert.equal(result.status, 0, `${boundary.name}: ${result.stderr || result.stdout || result.error}`)
    const output = `${result.stdout || ''}\n${result.stderr || ''}`
    for (const name of boundary.expected) assert.ok(output.includes(name), `${boundary.name} did not run ${name}`)
  })
}
