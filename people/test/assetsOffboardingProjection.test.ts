import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

const root = resolve(import.meta.dirname, '..')

test('People Assets offboarding projection is opt-in and uses a receipt-bound service command', () => {
  const drain = readFileSync(`${root}/server/utils/assetsOffboardingProjectionDrain.ts`, 'utf8')
  const task = readFileSync(`${root}/server/tasks/integrations/assets-offboarding.ts`, 'utf8')
  const render = readFileSync(`${root}/scripts/render-cloudflare-config.mjs`, 'utf8')
  assert.match(drain, /if \(!assetsOffboardingProjectionEnabled\(\)\)[\s\S]{0,180}requirePeopleScheduledRuntimeBinding\(\)/)
  assert.match(drain, /audience: 'assets'/)
  assert.match(drain, /scope: 'assets:offboarding-recovery:sync'/)
  assert.match(drain, /buildServiceCommandEnvelope\(operation\)/)
  assert.match(drain, /validateServiceCommandReceipt\(operation, rawReceipt/)
  assert.match(drain, /targetReceiptId: receipt\.receiptId/)
  assert.match(drain, /'idempotency-key': text\(operation\.idempotencyKey\)/)
  assert.match(drain, /for \(let page = 0; page < 20; page \+= 1\)/)
  assert.match(task, /maxClaims: 20/)
  assert.match(render, /HZY_PEOPLE_ASSETS_OFFBOARDING_SYNC_ENABLED: value\('HZY_PEOPLE_ASSETS_OFFBOARDING_SYNC_ENABLED', 'false'\)/)
  assert.doesNotMatch(`${drain}\n${task}\n${render}`.toLowerCase(), /console inactive|gitlab-runner|\.gitlab-ci/)
})
