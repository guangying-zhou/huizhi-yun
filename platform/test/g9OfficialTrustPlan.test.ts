import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildG9OfficialTrustPlan, SHARED_PLATFORM_ORIGIN } from '../scripts/g9-official-trust-plan.mjs'

const input = { runtimeEndpoint: 'https://aidcp-runtime.wiztek.cn', signingKid: 'psk_20260718_AElQdK3VQSja' }

test('official trust plan targets the shared hzy.wiztek.cn Platform everywhere', () => {
  const plan = buildG9OfficialTrustPlan(input)
  const text = JSON.stringify(plan)
  assert.equal(plan.platformOrigin, 'https://hzy.wiztek.cn')
  assert.equal(SHARED_PLATFORM_ORIGIN, 'https://hzy.wiztek.cn')
  assert.equal(text.includes('platform.wiztek.cn'), false)
  assert.equal(plan.stages.length, 9)
  assert.ok(plan.stages[8].expected.runtime.includes('control.platformUrl=https://hzy.wiztek.cn'))
  assert.ok(plan.stages[8].expected.enterprise.includes(`HZY_ENTERPRISE_POLICY_KEY_ID=${input.signingKid}`))
})

test('official trust plan never generates a key or rotates the tenant Runtime credential', () => {
  const stages = buildG9OfficialTrustPlan(input).stages
  const text = JSON.stringify(stages)
  assert.equal(/runtime-token/.test(text), false)
  assert.equal(/signing:key|generate a NEW/i.test(text), false)
  assert.equal(stages.some(stage => stage.path === '/api/platform/tenant-admin/runtime-token'), false)
  const onboarding = stages.find(stage => stage.path === '/api/platform/ops/onboarding/start')
  assert.ok(onboarding && /generateBundle=false/.test(onboarding.action) && /never the runtime_token step/.test(onboarding.action))
  assert.equal(text.includes('privateKey'), false)
})

test('official trust plan rejects unexpected input', () => {
  assert.throws(() => buildG9OfficialTrustPlan({ ...input, extra: 1 }))
  assert.throws(() => buildG9OfficialTrustPlan({ ...input, runtimeEndpoint: 'https://evil.example.com' }))
  assert.throws(() => buildG9OfficialTrustPlan({ ...input, signingKid: 'x' }))
})
