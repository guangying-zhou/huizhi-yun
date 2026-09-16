import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { decideLifecycleRevision } from '../server/utils/lifecycleRevisionDecision.ts'

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('Platform lifecycle mutation, monotonic watermark and receipt share one transaction', () => {
  const helper = source('server/utils/lifecycleServiceCommand.ts')
  const revision = source('server/utils/lifecycleRevisionDecision.ts')
  const employment = source('server/api/platform/internal/authorization/users/[uid]/employment.post.ts')
  assert.match(helper, /platform_lifecycle_scope_versions/)
  assert.match(helper, /service_command_receipt/)
  assert.match(helper, /staleSkipped/)
  assert.match(revision, /lifecycle_source_version_hash_mismatch/)
  assert.match(employment, /withTransaction\(tx => executePlatformLifecycleCommand/)
})

test('Platform accepts only signed Console binding and exact capabilities', () => {
  const helper = source('server/utils/lifecycleServiceCommand.ts')
  assert.match(helper, /platform:employment-authorization:sync/)
  assert.match(helper, /platform:offboarding-authorization:revoke/)
  assert.match(helper, /timingSafeEqual/)
  assert.match(helper, /deployments WHERE tenant_code=\? AND deployment_code=\?/)
  assert.match(helper, /originalActorUid/)
})

test('Platform lifecycle revision state machine is monotonic and hash-idempotent', () => {
  assert.equal(decideLifecycleRevision(7, 'a'.repeat(64), 8, 'b'.repeat(64)), 'apply')
  assert.equal(decideLifecycleRevision(7, 'a'.repeat(64), 7, 'a'.repeat(64)), 'idempotent')
  assert.equal(decideLifecycleRevision(7, 'a'.repeat(64), 6, 'c'.repeat(64)), 'stale')
  assert.throws(
    () => decideLifecycleRevision(7, 'a'.repeat(64), 7, 'd'.repeat(64)),
    (error: unknown) => Number((error as { statusCode?: unknown }).statusCode) === 409
      && (error as { statusMessage?: unknown }).statusMessage === 'lifecycle_source_version_hash_mismatch'
  )
})
