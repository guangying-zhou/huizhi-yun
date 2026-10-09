import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  assetsDueAuthorizationDescriptor,
  assetsDueCategory,
  assetsDueMessage,
  assetsDueNotificationsEnabled,
  assetsDueRecipientTransition,
  requireAssetsDueRuntimePage,
  resolveAssetsDueRecipient,
  type AssetsDueCandidate
} from '../server/utils/dueNotificationPolicy.ts'
import {
  AssetsDueEligibilityError,
  runAssetsDueEligibilityGate
} from '../server/utils/dueNotificationEligibility.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
const resourceCandidate: AssetsDueCandidate = {
  stream: 'resource_expiry',
  phase: 'D7',
  sourceType: 'asset_item',
  sourceId: 42,
  sourceCode: 'AST-042',
  sourceName: '生产域名',
  publicId: 'pub-asset-42',
  dueAt: '2026-07-17T23:59:59Z',
  recipientCandidates: ['owner', 'custodian', 'user'],
  eventVersion: 'assets-due:v1',
  idempotencyKey: 'assets-due:key',
  actionableKey: 'assets:asset_item:42:resource_expiry'
}

test('Assets due delivery is closed by default and only explicit truthy values enable it', () => {
  assert.equal(assetsDueNotificationsEnabled(undefined), false)
  assert.equal(assetsDueNotificationsEnabled('false'), false)
  assert.equal(assetsDueNotificationsEnabled('true'), true)
  assert.equal(assetsDueNotificationsEnabled('on'), true)
})

test('recipient selection preserves the runtime-provided order and only accepts active direct users', async () => {
  const calls: string[] = []
  const recipient = await resolveAssetsDueRecipient({
    ...resourceCandidate,
    recipientCandidates: ['@all', 'owner', 'owner', 'custodian', 'user']
  }, {
    findActiveUser: async (uid) => {
      calls.push(uid)
      if (uid === 'owner') return { uid, status: 0 }
      if (uid === 'custodian') return { uid, status: 'active' }
      return { uid, status: 1 }
    }
  })
  assert.equal(recipient, 'custodian')
  assert.deepEqual(calls, ['owner', 'custodian'])

  const missingStatus = await resolveAssetsDueRecipient(resourceCandidate, {
    findActiveUser: async uid => ({ uid })
  })
  assert.equal(missingStatus, null)
})

test('Directory fallback change closes the old UID and starts the new UID without predecessor CAS', async () => {
  const transitioned = {
    ...resourceCandidate,
    recipientCandidates: ['owner', 'custodian'],
    previousEventVersion: 'assets-due:delivered',
    previousRecipientUid: 'owner'
  }
  const firstRecipient = await resolveAssetsDueRecipient(transitioned, {
    findActiveUser: async uid => ({ uid, status: 1 })
  })
  const fallbackRecipient = await resolveAssetsDueRecipient(transitioned, {
    findActiveUser: async uid => uid === 'custodian' ? { uid, status: 'active' } : null
  })
  assert.equal(firstRecipient, 'owner')
  assert.equal(fallbackRecipient, 'custodian')
  assert.deepEqual(assetsDueRecipientTransition(transitioned, fallbackRecipient || ''), {
    previousObjectVersion: null,
    previousRecipientClosure: {
      expectedVersion: 'assets-due:delivered',
      recipientUid: 'owner'
    }
  })
})

test('same UID supersession keeps predecessor and owner-move replay remains deterministic', () => {
  const delivered = {
    ...resourceCandidate,
    previousEventVersion: 'assets-due:delivered',
    previousRecipientUid: 'owner'
  }
  assert.deepEqual(assetsDueRecipientTransition(delivered, 'owner'), {
    previousObjectVersion: 'assets-due:delivered',
    previousRecipientClosure: null
  })
  const firstAttempt = assetsDueRecipientTransition(delivered, 'custodian')
  const ackLossReplay = assetsDueRecipientTransition(delivered, 'custodian')
  assert.deepEqual(ackLossReplay, firstAttempt)
  assert.deepEqual(ackLossReplay, {
    previousObjectVersion: null,
    previousRecipientClosure: {
      expectedVersion: 'assets-due:delivered',
      recipientUid: 'owner'
    }
  })
})

function eligibilityGate(input: {
  eligibility?: { active: boolean, allowed: boolean }
  eligibilityError?: Error
  closePreviousRecipient?: boolean
  events: string[]
}) {
  return runAssetsDueEligibilityGate({
    purpose: resourceCandidate.stream,
    closePreviousRecipient: input.closePreviousRecipient ? async () => { input.events.push('close') } : undefined,
    checkEligibility: async (purpose: string) => {
      input.events.push(`eligibility:${purpose}`)
      if (input.eligibilityError) throw input.eligibilityError
      return input.eligibility || { active: true, allowed: true }
    },
    deliver: async () => {
      input.events.push('send')
      input.events.push('ack')
    }
  })
}

test('eligibility gates Assets publish/ack and purpose is the exact stream', async () => {
  const eligibleEvents: string[] = []
  await eligibilityGate({ events: eligibleEvents })
  assert.deepEqual(eligibleEvents, ['eligibility:resource_expiry', 'send', 'ack'])

  for (const eligibility of [{ active: false, allowed: false }, { active: true, allowed: false }]) {
    const events: string[] = []
    await assert.rejects(
      eligibilityGate({ events, eligibility }),
      (error: unknown) => error instanceof AssetsDueEligibilityError
        && error.code === 'assets_due_recipient_ineligible'
        && error.retryable
    )
    assert.deepEqual(events, ['eligibility:resource_expiry'])
  }
})

test('Assets eligibility 503 keeps retry and owner move closure precedes the check', async () => {
  const events: string[] = []
  await assert.rejects(
    eligibilityGate({
      events,
      closePreviousRecipient: true,
      eligibilityError: Object.assign(new Error('upstream unavailable'), { statusCode: 503 })
    }),
    (error: unknown) => error instanceof AssetsDueEligibilityError
      && error.code === 'assets_due_eligibility_unavailable'
      && error.retryable
  )
  assert.deepEqual(events, ['close', 'eligibility:resource_expiry'])
})

test('message and authorization descriptors use the frozen resource/IP routes and source codes', () => {
  assert.deepEqual(assetsDueAuthorizationDescriptor(resourceCandidate), {
    resource: 'asset_item', id: 'AST-042'
  })
  assert.equal(assetsDueMessage(resourceCandidate).url, '/assets/items/pub-asset-42')
  assert.equal(
    assetsDueMessage({ ...resourceCandidate, publicId: null }).url,
    '/assets/items/42'
  )

  const ipCandidate: AssetsDueCandidate = {
    ...resourceCandidate,
    stream: 'ip_expiry',
    sourceType: 'ip_asset',
    sourceId: 9,
    sourceCode: 'IP-009',
    sourceName: '商标',
    publicId: undefined,
    phase: 'expired'
  }
  assert.deepEqual(assetsDueAuthorizationDescriptor(ipCandidate), {
    resource: 'ip_asset', id: 'IP-009'
  })
  assert.equal(assetsDueMessage(ipCandidate).url, '/assets/ip-assets/9')
  assert.match(assetsDueMessage(ipCandidate).title, /expired/)

  const deliveryCandidate: AssetsDueCandidate = {
    ...resourceCandidate,
    stream: 'delivery_warranty',
    sourceType: 'customer_delivery_asset',
    sourceId: 12,
    sourceCode: 'CDA-012',
    sourceName: '客户许可实例',
    publicId: undefined,
    recipientCandidates: ['delivery-owner']
  }
  assert.deepEqual(assetsDueAuthorizationDescriptor(deliveryCandidate), {
    resource: 'customer_delivery_asset', id: 'CDA-012'
  })
  assert.equal(assetsDueMessage(deliveryCandidate).url, '/assets/customer-delivery-assets/CDA-012')
  assert.match(assetsDueMessage(deliveryCandidate).title, /质保到期/)

  const offboardingCandidate: AssetsDueCandidate = {
    ...resourceCandidate,
    stream: 'offboarding_unrecovered',
    sourceType: 'offboarding_recovery_case',
    sourceId: 17,
    sourceCode: 'ORC-017',
    sourceName: '张三仍有 2 项资产未回收',
    publicId: null,
    recipientCandidates: ['recovery-owner']
  }
  assert.deepEqual(assetsDueAuthorizationDescriptor(offboardingCandidate), {
    resource: 'offboarding_recovery_case', id: 'ORC-017'
  })
  assert.equal(assetsDueMessage(offboardingCandidate).url, '/assets/offboarding-recoveries/ORC-017')
  assert.match(assetsDueMessage(offboardingCandidate).title, /离职资产未回收/)
  assert.equal(assetsDueCategory(offboardingCandidate.stream), 'asset-recovery')
})

test('runtime page parser accepts only the frozen generic candidate and closure schema', () => {
  const asOf = '2026-07-10T12:00:00.000Z'
  const page = {
    stream: 'resource_expiry',
    asOf,
    items: [resourceCandidate],
    closures: [{
      checkpointEventVersion: 'assets-due:old',
      expectedVersion: 'assets-due:old',
      actionableKey: resourceCandidate.actionableKey,
      sourceType: 'asset_item',
      sourceId: 42,
      recipientUid: 'owner',
      nextVersion: 'resolved:assets-due:old',
      state: 'resolved'
    }],
    nextCursor: null
  }
  assert.deepEqual(requireAssetsDueRuntimePage(page, 'resource_expiry', asOf), page)
  assert.throws(
    () => requireAssetsDueRuntimePage({ ...page, asOf: '2026-07-10T12:01:00.000Z' }, 'resource_expiry', asOf),
    /page identity/
  )
  assert.throws(
    () => requireAssetsDueRuntimePage({
      ...page,
      items: [{ ...resourceCandidate, objectCode: resourceCandidate.sourceCode }]
    }, 'resource_expiry', asOf),
    /candidate shape/
  )
  assert.throws(
    () => requireAssetsDueRuntimePage({
      ...page,
      items: [{ ...resourceCandidate, phase: 'overdue' }]
    }, 'resource_expiry', asOf),
    /candidate values/
  )
  assert.throws(
    () => requireAssetsDueRuntimePage({
      ...page,
      stream: 'offboarding_unrecovered',
      items: [{
        ...resourceCandidate,
        stream: 'offboarding_unrecovered',
        sourceType: 'offboarding_recovery_case',
        recipientCandidates: ['owner', 'fallback-owner']
      }]
    }, 'offboarding_unrecovered', asOf),
    /candidate values/
  )
  assert.throws(
    () => requireAssetsDueRuntimePage({
      ...page,
      items: [{ ...resourceCandidate, sourceType: 'ip_asset' }]
    }, 'resource_expiry', asOf),
    /candidate values/
  )
  for (const invalidUid of ['', '@all', ' owner', `user-${'x'.repeat(124)}`, 'user\nname']) {
    assert.throws(
      () => requireAssetsDueRuntimePage({
        ...page,
        items: [{ ...resourceCandidate, recipientCandidates: [invalidUid] }]
      }, 'resource_expiry', asOf),
      /candidate values/
    )
  }
  assert.throws(
    () => requireAssetsDueRuntimePage({
      ...page,
      items: [{ ...resourceCandidate, idempotencyKey: 'x'.repeat(192) }]
    }, 'resource_expiry', asOf),
    /candidate values/
  )
})

test('Cloudflare due task is bounded, opt-in, server-owned and closes lifecycle before ack', () => {
  const drain = readFileSync(`${root}/server/utils/dueNotificationDrain.ts`, 'utf8')
  const task = readFileSync(`${root}/server/tasks/notifications/due.ts`, 'utf8')
  const config = readFileSync(`${root}/nuxt.config.ts`, 'utf8')
  const render = readFileSync(`${root}/scripts/render-cloudflare-config.mjs`, 'utf8')
  assert.match(task, /name:\s*'notifications:due'/)
  assert.match(task, /pageSize:\s*100/)
  assert.match(task, /maxPagesPerStream:\s*10/)
  assert.match(task, /maxWallTimeMs:\s*45_000/)
  assert.match(config, /'\*\/15 \* \* \* \*': \['notifications:due', 'integration-operations:delivery-asset-status'\]/)
  assert.match(render, /!enabled\('HZY_ASSETS_DUE_NOTIFICATIONS_ENABLED'\).*!enabled\('HZY_ASSETS_STATUS_OPERATIONS_ENABLED'\)/)
  assert.match(render, /Assets due notifications require explicit binding vars/)
  assert.match(render, /Assets due notifications require HZY_ASSETS_SERVICE_CLIENT_ID/)
  assert.match(drain, /if \(!isAssetsDueNotificationDeliveryEnabled\(\)\)[\s\S]{0,180}requireAssetsDueNotificationRuntimeBinding\(\)/)
  assert.match(drain, /const asOf = new Date\(\)\.toISOString\(\)/)
  for (const stream of ['resource_expiry', 'ip_expiry', 'delivery_expiry', 'delivery_warranty', 'delivery_support', 'offboarding_unrecovered']) {
    assert.match(drain, new RegExp(`'${stream}'`))
  }
  assert.match(drain, /requireAssetsDueRuntimePage\(runtimePage, stream, asOf\)/)
  assert.match(drain, /sendNotification\s*\(/)
  assert.match(drain, /checkSubjectEligibility\(\{ event, subjectUid: recipientUid, purpose \}\)/)
  assert.doesNotMatch(drain, /useEvent\(/)
  assert.match(task, /async run\(\{ context \}\)/)
  assert.match(task, /taskContext: context as Record<string, unknown>/)
  assert.match(drain, /event\?: H3Event/)
  assert.match(drain, /taskContext\?: Record<string, unknown>/)
  assert.match(drain, /options\.event \|\| taskEligibilityEvent\(options\.taskContext\)/)
  assert.ok(drain.indexOf('if (!isAssetsDueNotificationDeliveryEnabled())') < drain.lastIndexOf('requireAssetsDueNotificationRuntimeBinding()'))
  assert.ok(drain.lastIndexOf('requireAssetsDueNotificationRuntimeBinding()') < drain.indexOf('options.event || taskEligibilityEvent'))
  assert.ok(drain.indexOf('if (!isAssetsDueNotificationDeliveryEnabled())') < drain.lastIndexOf('await deliverCandidate(runtime, eligibilityEvent, candidate)'))
  // Without an injected unified caller the legacy purpose-signed worker contract is used.
  assert.match(drain, /const runtime: DueRuntimeCaller = options\.runtime \|\| callAssetsDueNotificationRuntime/)
  assert.doesNotMatch(drain, /callAssetsDueNotificationRuntime(<[^>]*>)?\('\/v1\/assets/)
  assert.match(drain, /assetsDueRecipientTransition\(candidate, recipientUid\)/)
  assert.match(drain, /previousObjectVersion: transition\.previousObjectVersion/)
  assert.match(drain, /authorizationDescriptor:\s*descriptor/)
  assert.match(drain, /actionableState:\s*'pending'/)
  assert.match(drain, /notifications:acknowledge-closure/)
  assert.match(drain, /await closeActionable\([\s\S]{0,300}await acknowledgeClosure\(runtime, closure\)/)
  assert.doesNotMatch(`${drain}\n${task}\n${render}`.toLowerCase(), /gitlab-runner|\.gitlab-ci/)
})

test('managed scheduled delivery requires service credentials, rejects static tokens, and permission-gates responsibility maintenance', () => {
  const runtime = readFileSync(`${root}/server/utils/scheduledRuntime.ts`, 'utf8')
  const detailPage = readFileSync(`${root}/app/pages/customer-delivery-assets/[code].vue`, 'utf8')
  assert.match(runtime, /if \(isManagedCloud\(config\)\)[\s\S]{0,500}!clientId \|\| !clientSecret/)
  assert.match(runtime, /managed Cloudflare scheduled tasks must not use a static runtime token/)
  assert.match(detailPage, /hasPermission\('deliveries', 'edit'\)/)
  assert.match(detailPage, /v-if="canEditDelivery"/)
})
