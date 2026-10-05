import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import type { H3Event } from 'h3'
import {
  deliverWorkflowRuntimeNotifications,
  type WorkflowNotificationRequest
} from '../server/utils/runtimeNotifications.ts'
import { deliverWorkflowActionableLifecyclesWithDependencies as deliverWorkflowActionableLifecycles } from '../server/utils/runtimeActionableLifecycles.ts'
import { resolveWorkflowNotificationURL } from '../server/utils/notificationActionUrl.js'
import { workflowResultNotificationPublishFailures } from '../server/utils/runtimeNotifications.ts'

const actionTargetCatalog = {
  applications: [
    { appCode: 'aims', homeUrl: 'https://aims.example.test/aims/', status: 'active' },
    { appCode: 'finance', homeUrl: 'https://finance.example.test/finance/', status: 'active' },
    { appCode: 'workflow', homeUrl: 'https://workflow.example.test/workflow/', status: 'active' }
  ],
  currentOrigin: 'https://console.example.test',
  source: 'policy_bundle' as const
}
const allowEligibility = async () => ({ active: true, allowed: true, reason: 'allowed' })

function notificationFor(eventType: string, metadata: Record<string, unknown> = {}) {
  return {
    touser: ['user-a'],
    title: 'Workflow notification',
    description: 'Review workflow state.',
    url: 'https://business.example.test/arbitrary/path',
    eventType,
    eventVersion: `event:${eventType}`,
    category: 'approval',
    severity: 'info' as const,
    bizType: 'business_resource',
    bizId: 'BIZ-1',
    idempotencyKey: `workflow:${eventType}:event`,
    metadata: {
      workflowInstanceId: 88,
      workflowTaskIds: [],
      targetAppCode: 'finance',
      businessTargetAppCode: 'finance',
      bizKey: 'finance:business_resource:BIZ-1',
      actionableKey: 'workflow:instance:88',
      ...metadata
    }
  }
}

test('Workflow sends each runtime notification through the unified entry exactly once', async () => {
  const sent: WorkflowNotificationRequest[] = []
  await deliverWorkflowRuntimeNotifications({} as H3Event, [{
    touser: ['user-b', 'user-a', 'user-b'],
    title: 'Approval required',
    description: 'Please review.',
    url: 'https://aims.example.test/aims/requirements/REQ-1',
    eventType: 'workflow.task.created',
    eventVersion: 'flow_tasks:1',
    category: 'approval',
    severity: 'info',
    bizType: 'workflow_instance',
    bizId: 10,
    idempotencyKey: 'workflow:workflow.task.created:flow_tasks:1',
    metadata: {
      workflowInstanceId: 10,
      workflowTaskIds: [1],
      targetAppCode: 'aims',
      bizKey: 'aims:requirements:REQ-1',
      actionableKey: 'workflow:tasks:sha256:abc',
      urlFallback: false
    }
  }], {
    send: async (params) => {
      sent.push(params)
    },
    loadActionTargetCatalog: async () => actionTargetCatalog,
    checkEligibility: allowEligibility
  })

  assert.equal(sent.length, 1)
  assert.deepEqual(sent[0], {
    touser: ['user-b', 'user-a'],
    title: 'Approval required',
    description: 'Please review.',
    url: 'https://workflow.example.test/workflow/tasks/1',
    sourceAppCode: 'workflow',
    eventType: 'workflow.task.created',
    category: 'approval',
    severity: 'info',
    bizType: 'workflow_instance',
    bizId: 10,
    idempotencyKey: 'workflow:workflow.task.created:flow_tasks:1',
    metadata: {
      workflowInstanceId: 10,
      workflowTaskIds: [1],
      targetAppCode: 'workflow',
      bizKey: 'aims:requirements:REQ-1',
      actionableKey: 'workflow:tasks:sha256:abc',
      businessTargetAppCode: 'aims',
      actionTargetAppCode: 'workflow',
      urlFallback: true,
      eventVersion: 'flow_tasks:1',
      sourceApp: 'workflow'
    },
    event: {}
  })
})

test('Workflow resolves only generated fallback links through its trusted origin', async () => {
  assert.equal(resolveWorkflowNotificationURL({
    url: '/workflow/tasks/701',
    metadata: {
      urlFallback: true,
      targetAppCode: 'finance',
      businessTargetAppCode: 'finance',
      actionTargetAppCode: 'workflow'
    }
  }, 'https://workflow.example.test'), 'https://workflow.example.test/workflow/tasks/701')
  assert.equal(resolveWorkflowNotificationURL({
    url: '/aims/requirements/REQ-1',
    metadata: { urlFallback: false }
  }, 'https://workflow.example.test'), '/aims/requirements/REQ-1')
  assert.equal(resolveWorkflowNotificationURL({
    url: 'javascript:alert(1)',
    metadata: { urlFallback: false }
  }, 'https://workflow.example.test'), '')
  assert.equal(resolveWorkflowNotificationURL({
    url: '//evil.example/path',
    metadata: { urlFallback: false }
  }, 'https://workflow.example.test'), '')

  const sent: WorkflowNotificationRequest[] = []
  await deliverWorkflowRuntimeNotifications({} as H3Event, [{
    touser: ['approver'],
    title: 'Approval required',
    description: 'Please review.',
    url: '/workflow/tasks/701',
    eventType: 'workflow.task.created',
    eventVersion: 'flow_tasks:701',
    category: 'approval',
    severity: 'info',
    bizType: 'payment_requests',
    bizId: 'PAY-42',
    idempotencyKey: 'workflow:workflow.task.created:flow_tasks:701',
    metadata: {
      workflowInstanceId: 88,
      workflowTaskIds: [701],
      targetAppCode: 'finance',
      businessTargetAppCode: 'finance',
      actionTargetAppCode: 'workflow',
      bizKey: 'finance:payment_requests:PAY-42',
      actionableKey: 'workflow:tasks:701',
      urlFallback: true
    }
  }], {
    send: async (params) => { sent.push(params) },
    loadActionTargetCatalog: async () => actionTargetCatalog,
    checkEligibility: allowEligibility
  })
  assert.equal(sent[0]?.url, 'https://workflow.example.test/workflow/tasks/701')
  assert.equal(sent[0]?.metadata?.targetAppCode, 'workflow')
  assert.equal(sent[0]?.metadata?.businessTargetAppCode, 'finance')
  assert.equal(sent[0]?.metadata?.actionTargetAppCode, 'workflow')

  const dataRuntime = readFileSync(new URL('../server/utils/dataRuntime.ts', import.meta.url), 'utf8')
  assert.match(dataRuntime, /loadNotificationActionTargetCatalog/)
  assert.doesNotMatch(dataRuntime, /getRequestURL\(event\)/)
})

test('Workflow replaces a target-mismatched business URL with its trusted task fallback', async () => {
  const sent: WorkflowNotificationRequest[] = []
  const result = await deliverWorkflowRuntimeNotifications({} as H3Event, [{
    touser: ['approver'],
    title: 'Approval required',
    url: 'https://evil.example.test/finance/payments/PAY-1',
    eventType: 'workflow.task.created',
    eventVersion: 'flow_tasks:701',
    category: 'approval',
    severity: 'info',
    bizType: 'payment_requests',
    bizId: 'PAY-1',
    idempotencyKey: 'workflow:workflow.task.created:flow_tasks:701',
    metadata: {
      workflowInstanceId: 88,
      workflowTaskIds: [701],
      targetAppCode: 'finance',
      businessTargetAppCode: 'finance',
      actionTargetAppCode: 'finance',
      bizKey: 'finance:payment_requests:PAY-1',
      actionableKey: 'workflow:tasks:701',
      urlFallback: false
    }
  }], {
    send: async (params) => { sent.push(params) },
    loadActionTargetCatalog: async () => actionTargetCatalog,
    checkEligibility: allowEligibility
  })

  assert.equal(result[0]?.status, 'published')
  assert.equal(sent[0]?.url, 'https://workflow.example.test/workflow/tasks/701')
  assert.equal(sent[0]?.metadata?.targetAppCode, 'workflow')
  assert.equal(sent[0]?.metadata?.businessTargetAppCode, 'finance')
  assert.equal(sent[0]?.metadata?.actionTargetAppCode, 'workflow')
  assert.equal(sent[0]?.metadata?.urlFallback, true)
})

test('Workflow derives only fixed task or instance eligibility purposes from its event allowlist and stable identities', async () => {
  const cases = [
    ['workflow.task.created', 'task_actionable', [701], 'https://workflow.example.test/workflow/tasks/701'],
    ['workflow.task.delegated', 'task_actionable', [701], 'https://workflow.example.test/workflow/tasks/701'],
    ['workflow.instance.resubmitted', 'task_actionable', [701], 'https://workflow.example.test/workflow/tasks/701'],
    ['workflow.instance.approved', 'instance_status', [], 'https://workflow.example.test/workflow/instances/88'],
    ['workflow.instance.rejected', 'instance_status', [701], 'https://workflow.example.test/workflow/instances/88'],
    ['workflow.instance.withdrawn', 'instance_status', [], 'https://workflow.example.test/workflow/instances/88']
  ] as const
  for (const [eventType, expectedPurpose, taskIds, expectedURL] of cases) {
    const purposes: string[] = []
    const sent: WorkflowNotificationRequest[] = []
    const result = await deliverWorkflowRuntimeNotifications({} as H3Event, [notificationFor(eventType, {
      workflowTaskIds: [...taskIds]
    })], {
      send: async (params) => { sent.push(params) },
      loadActionTargetCatalog: async () => actionTargetCatalog,
      checkEligibility: async ({ purpose }) => {
        purposes.push(purpose)
        return { active: true, allowed: true, reason: 'allowed' }
      }
    })
    assert.equal(result[0]?.status, 'published', eventType)
    assert.deepEqual(purposes, [expectedPurpose], eventType)
    assert.equal(sent[0]?.url, expectedURL, eventType)
    assert.equal(sent[0]?.metadata?.actionTargetAppCode, 'workflow')
    assert.equal(sent[0]?.metadata?.urlFallback, true)
  }
})

test('Workflow publishes parallel actionable tasks through canonical instance fallback after every recipient is eligible', async () => {
  const checked: string[] = []
  const sent: WorkflowNotificationRequest[] = []
  const result = await deliverWorkflowRuntimeNotifications({} as H3Event, [{
    ...notificationFor('workflow.task.created', { workflowTaskIds: [702, 701, 702] }),
    touser: ['approver-b', 'approver-a', 'approver-b']
  }], {
    send: async (params) => { sent.push(params) },
    loadActionTargetCatalog: async () => actionTargetCatalog,
    checkEligibility: async ({ subjectUid, purpose }) => {
      checked.push(`${subjectUid}:${purpose}`)
      return { active: true, allowed: true, reason: 'allowed' }
    }
  })
  assert.deepEqual(checked.sort(), [
    'approver-a:instance_actionable',
    'approver-b:instance_actionable'
  ])
  assert.equal(result[0]?.status, 'published')
  assert.equal(sent[0]?.url, 'https://workflow.example.test/workflow/instances/88')
  assert.deepEqual(sent[0]?.touser, ['approver-b', 'approver-a'])
  assert.equal(sent[0]?.metadata?.actionTargetAppCode, 'workflow')
  assert.equal(sent[0]?.metadata?.urlFallback, true)
})

test('Workflow checks every deduplicated recipient and blocks the whole notification when any recipient is ineligible', async () => {
  const checked: string[] = []
  let sends = 0
  const result = await deliverWorkflowRuntimeNotifications({} as H3Event, [{
    ...notificationFor('workflow.task.created', { workflowTaskIds: [701, 702] }),
    touser: ['allowed', 'denied', 'allowed', 'inactive']
  }], {
    send: async () => { sends += 1 },
    loadActionTargetCatalog: async () => actionTargetCatalog,
    checkEligibility: async ({ subjectUid, purpose }) => {
      checked.push(`${subjectUid}:${purpose}`)
      if (subjectUid === 'inactive') return { active: false, allowed: false, reason: 'subject_inactive' }
      return { active: true, allowed: subjectUid !== 'denied', reason: subjectUid === 'denied' ? 'permission_denied' : 'allowed' }
    }
  })
  assert.deepEqual(checked.sort(), [
    'allowed:instance_actionable',
    'denied:instance_actionable',
    'inactive:instance_actionable'
  ])
  assert.equal(sends, 0)
  assert.equal(result[0]?.code, 'workflow_notification_recipient_ineligible')
})

test('Workflow blocks the whole notification when any recipient eligibility request fails', async () => {
  const checked: string[] = []
  let sends = 0
  const result = await deliverWorkflowRuntimeNotifications({} as H3Event, [{
    ...notificationFor('workflow.task.created', { workflowTaskIds: [701, 702] }),
    touser: ['user-a', 'user-b']
  }], {
    send: async () => { sends += 1 },
    loadActionTargetCatalog: async () => actionTargetCatalog,
    checkEligibility: async ({ subjectUid, purpose }) => {
      checked.push(`${subjectUid}:${purpose}`)
      if (subjectUid === 'user-b') throw Object.assign(new Error('policy unavailable'), { statusCode: 503 })
      return { active: true, allowed: true, reason: 'allowed' }
    }
  })
  assert.deepEqual(checked.sort(), [
    'user-a:instance_actionable',
    'user-b:instance_actionable'
  ])
  assert.equal(sends, 0)
  assert.equal(result[0]?.code, 'workflow_notification_eligibility_unavailable')
})

test('Workflow logs only the status and machine code of an eligibility failure', async () => {
  const logged: unknown[] = []
  for (const [reason, expected] of [
    [Object.assign(new Error('subject_eligibility_runtime_binding_unavailable'), { statusCode: 503 }), { causeStatus: 503, causeCode: 'subject_eligibility_runtime_binding_unavailable', causeClass: 'Error' }],
    [Object.assign(new Error('Bearer eyJsecret failed for user-a'), { statusCode: 502 }), { causeStatus: 502, causeClass: 'Error' }]
  ] as const) {
    logged.length = 0
    await deliverWorkflowRuntimeNotifications({} as H3Event, [notificationFor('workflow.task.created', { workflowTaskIds: [701] })], {
      send: async () => {},
      loadActionTargetCatalog: async () => actionTargetCatalog,
      checkEligibility: async () => { throw reason },
      error: (_message, detail) => { logged.push(detail) }
    })
    assert.deepEqual(logged, [{ code: 'workflow_notification_eligibility_unavailable', ...expected }])
  }
})

test('Workflow fails closed for unknown, contradictory, or unstable fallback contracts before eligibility and catalog access', async () => {
  const invalid = [
    notificationFor('workflow.task.unknown', { workflowTaskIds: [701] }),
    notificationFor('workflow.task.created', { workflowTaskIds: [] }),
    notificationFor('workflow.task.created', { workflowTaskIds: ['701'] }),
    notificationFor('workflow.instance.approved', { workflowInstanceId: 0 }),
    notificationFor('workflow.instance.withdrawn', { workflowTaskIds: [701] }),
    notificationFor('workflow.instance.approved', { businessTargetAppCode: 'aims' })
  ]
  let eligibilityChecks = 0
  let catalogLoads = 0
  let sends = 0
  const results = await deliverWorkflowRuntimeNotifications({} as H3Event, invalid, {
    send: async () => { sends += 1 },
    loadActionTargetCatalog: async () => {
      catalogLoads += 1
      return actionTargetCatalog
    },
    checkEligibility: async () => {
      eligibilityChecks += 1
      return { active: true, allowed: true, reason: 'allowed' }
    }
  })
  assert.equal(eligibilityChecks, 0)
  assert.equal(catalogLoads, 0)
  assert.equal(sends, 0)
  assert.ok(results.every(result => result.code === 'workflow_notification_eligibility_contract_invalid'))
})

test('Workflow eligibility purpose never derives from business target, biz type, requested URL, or action target metadata', async () => {
  const observed: Array<{ subjectUid: string, purpose: string }> = []
  const sent: WorkflowNotificationRequest[] = []
  const result = await deliverWorkflowRuntimeNotifications({} as H3Event, [{
    ...notificationFor('workflow.task.created', {
      workflowTaskIds: [701],
      targetAppCode: 'aims',
      businessTargetAppCode: 'aims',
      actionTargetAppCode: 'finance'
    }),
    url: 'https://evil.example.test/admin',
    bizType: 'cross_app_admin_probe'
  }], {
    send: async (params) => { sent.push(params) },
    loadActionTargetCatalog: async () => actionTargetCatalog,
    checkEligibility: async ({ subjectUid, purpose }) => {
      observed.push({ subjectUid, purpose })
      return { active: true, allowed: true, reason: 'allowed' }
    }
  })
  assert.equal(result[0]?.status, 'published')
  assert.deepEqual(observed, [{ subjectUid: 'user-a', purpose: 'task_actionable' }])
  assert.equal(sent[0]?.url, 'https://workflow.example.test/workflow/tasks/701')
  assert.equal(sent[0]?.metadata?.targetAppCode, 'workflow')
  assert.equal(sent[0]?.metadata?.businessTargetAppCode, 'aims')
  assert.equal(sent[0]?.metadata?.businessTargetAppCode, 'aims')
  assert.equal(sent[0]?.metadata?.actionTargetAppCode, 'workflow')
})

test('Workflow keeps publication failed when its trusted application catalog is unavailable', async () => {
  let sends = 0
  const result = await deliverWorkflowRuntimeNotifications({} as H3Event, [{
    touser: ['approver'],
    title: 'Approval required',
    url: '/finance/payments/PAY-1',
    eventType: 'workflow.task.created',
    eventVersion: 'flow_tasks:702',
    category: 'approval',
    severity: 'info',
    bizType: 'payment_requests',
    bizId: 'PAY-1',
    idempotencyKey: 'workflow:workflow.task.created:flow_tasks:702',
    metadata: {
      workflowInstanceId: 88,
      workflowTaskIds: [702],
      targetAppCode: 'finance',
      bizKey: 'finance:payment_requests:PAY-1',
      actionableKey: 'workflow:tasks:702'
    }
  }], {
    send: async () => { sends += 1 },
    loadActionTargetCatalog: async () => null,
    checkEligibility: allowEligibility
  })

  assert.equal(sends, 0)
  assert.deepEqual(result, [{
    idempotencyKey: 'workflow:workflow.task.created:flow_tasks:702',
    status: 'failed',
    code: 'workflow_notification_action_target_unavailable'
  }])
})

test('Workflow skips notifications without a database-stable event identity', async () => {
  const sent: WorkflowNotificationRequest[] = []
  const logged: Array<{ message: string, error: unknown }> = []
  await deliverWorkflowRuntimeNotifications({} as H3Event, [{
    touser: ['user-a'],
    title: 'Approval required',
    url: 'https://tenant.example.test/workflow/tasks/1',
    eventType: 'workflow.task.created',
    category: 'approval',
    severity: 'info',
    bizType: 'workflow_instance',
    bizId: 10,
    metadata: { instanceId: 10 }
  }], {
    send: async (params) => {
      sent.push(params)
    },
    error: (message, error) => logged.push({ message, error }),
    loadActionTargetCatalog: async () => actionTargetCatalog,
    checkEligibility: allowEligibility
  })

  assert.equal(sent.length, 0)
  assert.deepEqual(logged, [{
    message: '[WorkflowRuntime] 跳过缺少稳定事件身份的通知',
    error: { code: 'workflow_notification_identity_missing' }
  }])
})

test('Workflow no longer publishes in-app before calling the unified notification entry', () => {
  const dataRuntime = readFileSync(new URL('../server/utils/dataRuntime.ts', import.meta.url), 'utf8')
  const notifications = readFileSync(new URL('../server/utils/runtimeNotifications.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(dataRuntime, /\bpublishNotification\(/)
  assert.match(dataRuntime, /deliverWorkflowRuntimeNotifications\(event, notifications, dependencies\)/)
  assert.equal((notifications.match(/await dependencies\.send\(/g) || []).length, 1)
})

test('Workflow publishes prerequisite notification before lifecycle CAS and checkpoints ack', async () => {
  const calls: string[] = []
  const tokenRequests: Array<Record<string, unknown>> = []
  const event = {} as H3Event
  const request = async () => {
    calls.push('console')
    return { code: 0 }
  }

  const result = await deliverWorkflowActionableLifecycles(event, [{
    effectId: 41,
    versionNo: 1,
    actionableKey: 'workflow:tasks:g1',
    expectedVersion: 'flow_tasks:g1',
    nextVersion: 'flow_actions:9',
    state: 'resolved',
    recipients: ['u1'],
    prerequisiteNotifications: [{
      touser: ['u2'],
      eventType: 'workflow.task.created',
      eventVersion: 'flow_tasks:g2',
      idempotencyKey: 'workflow:workflow.task.created:flow_tasks:g2'
    }]
  }], {
    requestAccessToken: async (options) => {
      tokenRequests.push(options as Record<string, unknown>)
      return 'service-token'
    },
    request,
    resolveConsoleBaseUrl: () => 'https://console.example.test',
    publishNotifications: async () => {
      calls.push('notification')
      return [{ status: 'published' }]
    },
    checkpoint: async (_event, effectId, versionNo, outcome) => {
      assert.equal(versionNo, 1)
      calls.push(`${outcome}:${effectId}`)
    }
  })

  assert.deepEqual(calls, ['notification', 'console', 'ack:41'])
  assert.equal(tokenRequests[0]?.event, event)
  assert.equal(tokenRequests[0]?.audience, 'notifications')
  assert.equal(result[0]?.status, 'delivered')
})

test('Workflow keeps ack-loss lifecycle pending and exact replay can acknowledge it', async () => {
  let checkpointAttempts = 0
  let consoleCalls = 0
  const dependencies = {
    requestAccessToken: async () => 'service-token',
    request: async () => {
      consoleCalls += 1
      return { code: 0 }
    },
    resolveConsoleBaseUrl: () => 'https://console.example.test',
    publishNotifications: async () => [{ status: 'published' }],
    checkpoint: async (_event: H3Event, _effectId: number, versionNo: number, outcome: 'ack' | 'fail') => {
      assert.equal(versionNo, 1)
      if (outcome === 'ack' && checkpointAttempts++ === 0) throw new Error('ack lost')
    },
    error: () => {}
  }
  const effect = {
    effectId: 42,
    versionNo: 1,
    actionableKey: 'workflow:tasks:g1',
    expectedVersion: 'flow_tasks:g1',
    nextVersion: 'flow_actions:10',
    state: 'cancelled' as const,
    recipients: ['u2']
  }

  const first = await deliverWorkflowActionableLifecycles({} as H3Event, [effect], dependencies)
  const replay = await deliverWorkflowActionableLifecycles({} as H3Event, [effect], dependencies)

  assert.equal(first[0]?.status, 'pending')
  assert.equal(replay[0]?.status, 'delivered')
  assert.equal(consoleCalls, 2)
})

test('Workflow does not close old generation when prerequisite publication is partial', async () => {
  let consoleCalls = 0
  const checkpoints: string[] = []
  const result = await deliverWorkflowActionableLifecycles({} as H3Event, [{
    effectId: 43,
    versionNo: 1,
    actionableKey: 'workflow:tasks:old',
    expectedVersion: 'flow_tasks:old',
    nextVersion: 'flow_actions:11',
    state: 'cancelled',
    recipients: ['old-assignee'],
    prerequisiteNotifications: [{ eventType: 'workflow.task.created' }]
  }], {
    requestAccessToken: async () => 'unused',
    request: async () => { consoleCalls += 1 },
    resolveConsoleBaseUrl: () => 'https://console.example.test',
    publishNotifications: async () => [{ status: 'published' }, { status: 'failed' }],
    checkpoint: async (_event, effectId, versionNo, outcome) => { checkpoints.push(`${outcome}:${effectId}:${versionNo}`) }
  })

  assert.equal(consoleCalls, 0)
  assert.deepEqual(checkpoints, ['fail:43:1'])
  assert.equal(result[0]?.status, 'pending')
  assert.equal(result[0]?.code, 'notification_publish_incomplete')
})

test('Workflow refreshes the service token once after Console 401', async () => {
  const tokenRequests: Array<Record<string, unknown>> = []
  let requests = 0
  const result = await deliverWorkflowActionableLifecycles({} as H3Event, [{
    effectId: 44,
    versionNo: 1,
    actionableKey: 'workflow:tasks:g1',
    expectedVersion: 'flow_tasks:g1',
    nextVersion: 'flow_actions:12',
    state: 'resolved',
    recipients: ['u1']
  }], {
    requestAccessToken: async (options) => {
      tokenRequests.push(options)
      return options.forceRefresh ? 'fresh' : 'cached'
    },
    request: async () => {
      requests += 1
      if (requests === 1) throw { response: { status: 401 } }
    },
    resolveConsoleBaseUrl: () => 'https://console.example.test',
    publishNotifications: async () => [],
    checkpoint: async () => {}
  }, false)

  assert.equal(result[0]?.status, 'delivered')
  assert.equal(requests, 2)
  assert.equal(tokenRequests[0]?.forceRefresh, undefined)
  assert.equal(tokenRequests[1]?.forceRefresh, true)
})

test('Workflow stops after the second Console 401 and keeps the outbox pending', async () => {
  let tokenRequests = 0
  let requests = 0
  const checkpoints: string[] = []
  const result = await deliverWorkflowActionableLifecycles({} as H3Event, [{
    effectId: 45,
    versionNo: 1,
    actionableKey: 'workflow:tasks:g1',
    expectedVersion: 'flow_tasks:g1',
    nextVersion: 'flow_actions:13',
    state: 'resolved',
    recipients: ['u1']
  }], {
    requestAccessToken: async () => {
      tokenRequests += 1
      return `token-${tokenRequests}`
    },
    request: async () => {
      requests += 1
      throw { response: { status: 401 } }
    },
    resolveConsoleBaseUrl: () => 'https://console.example.test',
    publishNotifications: async () => [],
    checkpoint: async (_event, effectId, versionNo, outcome) => { checkpoints.push(`${outcome}:${effectId}:${versionNo}`) },
    error: () => {}
  }, false)

  assert.equal(result[0]?.status, 'pending')
  assert.equal(tokenRequests, 2)
  assert.equal(requests, 2)
  assert.deepEqual(checkpoints, ['fail:45:1'])
})

test('Workflow records an actionable 404 as a bounded retry with a fixed code', async () => {
  const checkpoints: Array<{ outcome: string, code?: string, status?: number }> = []
  const result = await deliverWorkflowActionableLifecycles({} as H3Event, [{
    effectId: 46,
    versionNo: 1,
    actionableKey: 'workflow:tasks:g2',
    expectedVersion: 'flow_tasks:g2',
    nextVersion: 'flow_actions:14',
    state: 'resolved',
    recipients: ['u2']
  }], {
    requestAccessToken: async () => 'token',
    request: async () => { throw { response: { status: 404 }, data: { message: 'private error' } } },
    resolveConsoleBaseUrl: () => 'https://console.example.test',
    publishNotifications: async () => [],
    checkpoint: async (_event, _effectId, versionNo, outcome, code, status) => {
      assert.equal(versionNo, 1)
      checkpoints.push({ outcome, code, status })
    },
    error: () => {}
  }, false)
  assert.equal(result[0]?.status, 'pending')
  assert.deepEqual(checkpoints, [{ outcome: 'fail', code: 'actionable_not_found', status: 404 }])
})

test('Workflow publish failure logs only safe nested in-app cause fields', async () => {
  const logged: unknown[] = []
  const reason = Object.assign(new Error('Bearer secret body recipient user-a'), {
    statusCode: 400, data: { code: 'invalid_action_target', body: 'private payload' }
  })
  await deliverWorkflowRuntimeNotifications({} as H3Event, [notificationFor('workflow.task.created', { workflowTaskIds: [701] })], {
    send: async () => { throw { result: { inApp: { reason }, external: { reason: 'secret' } } } },
    loadActionTargetCatalog: async () => actionTargetCatalog,
    checkEligibility: async () => ({ active: true, allowed: true, reason: 'allowed' }),
    error: (_message, detail) => { logged.push(detail) }
  })
  assert.deepEqual(logged, [{ code: 'workflow_notification_publish_failed', causeStatus: 400, causeCode: 'invalid_action_target', causeClass: 'Error' }])
})

test('Workflow binds a deployed Enterprise task target while preserving eligibility and business identity', async () => {
  const sent: WorkflowNotificationRequest[] = []
  const purposes: string[] = []
  const catalog = { ...actionTargetCatalog, applications: [...actionTargetCatalog.applications,
    { appCode: 'enterprise', status: 'active', deploymentState: 'deployed' as const, homeUrl: 'https://enterprise.example.test/', basePath: '/' }] }
  await deliverWorkflowRuntimeNotifications({} as H3Event, [notificationFor('workflow.task.created', { workflowTaskIds: [5] })], {
    loadActionTargetCatalog: async () => catalog,
    checkEligibility: async ({ purpose }) => {
      purposes.push(purpose)
      return await allowEligibility()
    },
    send: async (p) => { sent.push(p) }
  })
  assert.deepEqual(purposes, ['task_actionable'])
  assert.equal(sent[0]?.url, 'https://enterprise.example.test/enterprise/approvals/5')
  assert.equal(sent[0]?.metadata?.targetAppCode, 'enterprise')
  assert.equal(sent[0]?.metadata?.actionTargetAppCode, 'enterprise')
  assert.equal(sent[0]?.metadata?.businessTargetAppCode, 'finance')
})

test('Workflow falls back for missing, inactive, unproven or undeployed Enterprise, never a caller URL', async () => {
  for (const host of [undefined,
    { status: 'inactive', deploymentState: 'deployed' },
    { status: 'active', deploymentState: 'not-deployed' },
    { status: 'active' }]) {
    const sent: WorkflowNotificationRequest[] = []
    await deliverWorkflowRuntimeNotifications({} as H3Event, [notificationFor('workflow.task.created', { workflowTaskIds: [5] })], {
      loadActionTargetCatalog: async () => ({ ...actionTargetCatalog, applications: [...actionTargetCatalog.applications, ...(host ? [{ appCode: 'enterprise', homeUrl: 'https://enterprise.example.test/', ...host }] : [])] } as typeof actionTargetCatalog),
      checkEligibility: allowEligibility, send: async (p) => { sent.push(p) }
    })
    assert.equal(sent[0]?.url, 'https://workflow.example.test/workflow/tasks/5')
    assert.equal(sent[0]?.metadata?.targetAppCode, 'workflow')
  }
})

test('Workflow fails closed for inconsistent deployed Enterprise homes and duplicate entries', async () => {
  for (const apps of [
    [{ appCode: 'enterprise', status: 'active', deploymentState: 'deployed' as const, homeUrl: null }],
    [{ appCode: 'enterprise', status: 'active', deploymentState: 'deployed' as const, homeUrl: 'javascript:invalid' }],
    [1, 2].map(() => ({ appCode: 'enterprise', status: 'active', deploymentState: 'deployed' as const, homeUrl: 'https://enterprise.example.test/' }))
  ]) {
    let sends = 0
    const result = await deliverWorkflowRuntimeNotifications({} as H3Event, [notificationFor('workflow.task.created', { workflowTaskIds: [5] })], {
      loadActionTargetCatalog: async () => ({ ...actionTargetCatalog, applications: [...actionTargetCatalog.applications, ...apps] }),
      checkEligibility: allowEligibility, send: async () => { sends++ }
    })
    assert.equal(sends, 0)
    assert.equal(result[0]?.code, 'workflow_notification_action_target_unavailable')
  }
})

const deployedHost = { appCode: 'enterprise', status: 'active', deploymentState: 'deployed' as const, homeUrl: 'https://enterprise.example.test/', basePath: '/' }
const instanceCases = [
  ['workflow.task.created', [701, 702]],
  ['workflow.instance.approved', []],
  ['workflow.instance.rejected', [701]]
] as const

test('Workflow instance, parallel and status actions fall back to the Host approvals list when only the Host is trusted', async () => {
  const untrustedWorkflow = [
    [],
    [{ appCode: 'workflow', status: 'active', homeUrl: null }],
    [{ appCode: 'workflow', status: 'active', deploymentState: 'not-deployed' as const, homeUrl: 'https://workflow.example.test/workflow/' }]
  ]
  for (const workflowApps of untrustedWorkflow) {
    for (const [eventType, taskIds] of instanceCases) {
      const sent: WorkflowNotificationRequest[] = []
      const warned: unknown[] = []
      const errors: unknown[] = []
      const result = await deliverWorkflowRuntimeNotifications({} as H3Event, [notificationFor(eventType, { workflowTaskIds: [...taskIds] })], {
        loadActionTargetCatalog: async () => ({ ...actionTargetCatalog, applications: [
          ...actionTargetCatalog.applications.filter(app => app.appCode !== 'workflow'), ...workflowApps, deployedHost] }),
        checkEligibility: allowEligibility,
        send: async (p) => { sent.push(p) },
        warn: (_message, detail) => { warned.push(detail) },
        error: (_message, detail) => { errors.push(detail) }
      })
      assert.equal(result[0]?.status, 'published', eventType)
      assert.equal(sent[0]?.url, 'https://enterprise.example.test/enterprise/approvals', eventType)
      assert.equal(sent[0]?.metadata?.targetAppCode, 'enterprise')
      assert.equal(sent[0]?.metadata?.actionTargetAppCode, 'enterprise')
      assert.equal(sent[0]?.metadata?.businessTargetAppCode, 'finance')
      assert.equal(sent[0]?.metadata?.urlFallback, true)
      assert.equal(warned.length, 1)
      assert.equal((warned[0] as { code?: string }).code, 'workflow_action_target_host_list_fallback')
      assert.deepEqual(errors, [])
    }
  }
})

test('Workflow keeps its instance route when it has a trusted home even if the Host is deployed', async () => {
  for (const [eventType, taskIds] of instanceCases) {
    const sent: WorkflowNotificationRequest[] = []
    const warned: unknown[] = []
    await deliverWorkflowRuntimeNotifications({} as H3Event, [notificationFor(eventType, { workflowTaskIds: [...taskIds] })], {
      loadActionTargetCatalog: async () => ({ ...actionTargetCatalog, applications: [...actionTargetCatalog.applications, deployedHost] }),
      checkEligibility: allowEligibility,
      send: async (p) => { sent.push(p) },
      warn: (_message, detail) => { warned.push(detail) }
    })
    assert.equal(sent[0]?.url, 'https://workflow.example.test/workflow/instances/88', eventType)
    assert.equal(sent[0]?.metadata?.actionTargetAppCode, 'workflow')
    assert.deepEqual(warned, [])
  }
})

test('Workflow fails closed with a distinct reason when neither the Host nor Workflow is a trusted target', async () => {
  for (const host of [undefined, { ...deployedHost, deploymentState: 'not-deployed' as const }, { ...deployedHost, status: 'inactive' }]) {
    for (const [eventType, taskIds] of [...instanceCases, ['workflow.task.created', [701]] as const]) {
      let sends = 0
      const errors: unknown[] = []
      const result = await deliverWorkflowRuntimeNotifications({} as H3Event, [notificationFor(eventType, { workflowTaskIds: [...taskIds] })], {
        loadActionTargetCatalog: async () => ({ ...actionTargetCatalog, applications: [
          ...actionTargetCatalog.applications.filter(app => app.appCode !== 'workflow'), ...(host ? [host] : [])] }),
        checkEligibility: allowEligibility,
        send: async () => { sends += 1 },
        error: (_message, detail) => { errors.push(detail) }
      })
      assert.equal(sends, 0)
      assert.equal(result[0]?.code, 'workflow_notification_action_target_unavailable')
      assert.deepEqual(errors.map(detail => (detail as { code?: string }).code), [
        'workflow_action_target_host_not_deployed',
        'workflow_notification_action_target_unavailable'
      ])
    }
  }
})

test('Workflow fails closed without a list fallback when the deployed Host home is untrusted', async () => {
  let sends = 0
  const result = await deliverWorkflowRuntimeNotifications({} as H3Event, [notificationFor('workflow.instance.approved')], {
    loadActionTargetCatalog: async () => ({ ...actionTargetCatalog, applications: [
      ...actionTargetCatalog.applications.filter(app => app.appCode !== 'workflow'), { ...deployedHost, homeUrl: 'javascript:invalid' }] }),
    checkEligibility: allowEligibility,
    send: async () => { sends += 1 }
  })
  assert.equal(sends, 0)
  assert.equal(result[0]?.code, 'workflow_notification_action_target_unavailable')
})

test('Workflow logs a fixed reason with only status and class when the action target catalog cannot load', async () => {
  const cases = [
    [async () => { throw Object.assign(new Error('GET https://console.example.test/x?token=secret failed'), { statusCode: 503, data: { code: 'leak_me' } }) },
      { code: 'workflow_action_target_catalog_unavailable', causeStatus: 503, causeClass: 'Error' }],
    [async () => null, { code: 'workflow_action_target_catalog_unavailable', causeCode: 'catalog_missing' }]
  ] as const
  for (const [loadActionTargetCatalog, expected] of cases) {
    const logged: unknown[] = []
    let loads = 0
    const result = await deliverWorkflowRuntimeNotifications({} as H3Event, [
      notificationFor('workflow.task.created', { workflowTaskIds: [701] }),
      notificationFor('workflow.instance.approved')
    ], {
      loadActionTargetCatalog: async (event) => {
        loads += 1
        return await loadActionTargetCatalog(event)
      },
      checkEligibility: allowEligibility,
      send: async () => {},
      error: (_message, detail) => { logged.push(detail) }
    })
    assert.equal(loads, 1)
    assert.ok(result.every(item => item.code === 'workflow_notification_action_target_unavailable'))
    assert.deepEqual(logged, [expected, { code: 'workflow_notification_action_target_unavailable' }, { code: 'workflow_notification_action_target_unavailable' }])
    assert.doesNotMatch(JSON.stringify(logged), /secret|console\.example|leak_me/)
  }
  const dataRuntime = readFileSync(new URL('../server/utils/dataRuntime.ts', import.meta.url), 'utf8')
  assert.match(dataRuntime, /onBundleError: error => console\.error\([^)]*\{\s*code: 'workflow_action_target_catalog_unavailable'/)
  const foundationLoader = readFileSync(new URL('../../foundation/server/utils/notificationActionTarget.ts', import.meta.url), 'utf8')
  assert.match(foundationLoader, /catch \(error\) \{[^}]*options\.onBundleError\?\.\(error\)/)
})

test('a failed result notification publish increments the counter and logs only the fixed allowed fields', async () => {
  const before = workflowResultNotificationPublishFailures()
  const resultLogged: unknown[] = []
  const reason = Object.assign(new Error('Bearer secret body recipient user-a'), {
    statusCode: 502, data: { code: 'console_publish_failed', body: 'private payload' }
  })
  const result = await deliverWorkflowRuntimeNotifications({} as H3Event, [notificationFor('workflow.instance.approved')], {
    send: async () => { throw { result: { inApp: { reason }, external: { reason: 'secret' } } } },
    loadActionTargetCatalog: async () => actionTargetCatalog,
    checkEligibility: allowEligibility,
    error: () => {},
    logResultNotificationFailure: (_message, detail) => { resultLogged.push(detail) }
  })
  assert.equal(result[0]?.status, 'failed')
  assert.equal(workflowResultNotificationPublishFailures(), before + 1)
  assert.deepEqual(resultLogged, [{
    code: 'workflow_result_notification_publish_failed',
    instanceId: 88,
    eventType: 'workflow.instance.approved',
    causeStatus: 502,
    causeClass: 'Error',
    causeCode: 'console_publish_failed'
  }])
  assert.doesNotMatch(JSON.stringify(resultLogged), /secret|payload|user-a/)
})

test('a failed prerequisite (task-actionable) notification publish is not counted or logged as a result-notification failure', async () => {
  const before = workflowResultNotificationPublishFailures()
  const resultLogged: unknown[] = []
  const result = await deliverWorkflowRuntimeNotifications({} as H3Event, [notificationFor('workflow.task.created', { workflowTaskIds: [701] })], {
    send: async () => { throw new Error('boom') },
    loadActionTargetCatalog: async () => actionTargetCatalog,
    checkEligibility: allowEligibility,
    error: () => {},
    logResultNotificationFailure: (_message, detail) => { resultLogged.push(detail) }
  })
  assert.equal(result[0]?.status, 'failed')
  assert.equal(workflowResultNotificationPublishFailures(), before)
  assert.deepEqual(resultLogged, [])
})

test('a rejected instance with rejectStrategy=to_previous is durable and is not counted, while other rejections are', async () => {
  const before = workflowResultNotificationPublishFailures()
  const resultLogged: unknown[] = []
  const toPrevious = await deliverWorkflowRuntimeNotifications({} as H3Event, [
    notificationFor('workflow.instance.rejected', { workflowTaskIds: [701], rejectStrategy: 'to_previous' })
  ], {
    send: async () => { throw new Error('boom') },
    loadActionTargetCatalog: async () => actionTargetCatalog,
    checkEligibility: allowEligibility,
    error: () => {},
    logResultNotificationFailure: (_message, detail) => { resultLogged.push(detail) }
  })
  assert.equal(toPrevious[0]?.status, 'failed')
  assert.equal(workflowResultNotificationPublishFailures(), before)
  assert.deepEqual(resultLogged, [])

  const terminal = await deliverWorkflowRuntimeNotifications({} as H3Event, [
    notificationFor('workflow.instance.rejected', { workflowTaskIds: [701], rejectStrategy: 'to_initiator' })
  ], {
    send: async () => { throw new Error('boom') },
    loadActionTargetCatalog: async () => actionTargetCatalog,
    checkEligibility: allowEligibility,
    error: () => {},
    logResultNotificationFailure: (_message, detail) => { resultLogged.push(detail) }
  })
  assert.equal(terminal[0]?.status, 'failed')
  assert.equal(workflowResultNotificationPublishFailures(), before + 1)
  assert.equal(resultLogged.length, 1)
  assert.equal((resultLogged[0] as { eventType?: string }).eventType, 'workflow.instance.rejected')
})

test('a result notification counts on eligibility denial/unavailable and on an unavailable action target', async () => {
  const before = workflowResultNotificationPublishFailures()
  const resultLogged: unknown[] = []

  await deliverWorkflowRuntimeNotifications({} as H3Event, [notificationFor('workflow.instance.withdrawn')], {
    send: async () => {},
    loadActionTargetCatalog: async () => actionTargetCatalog,
    checkEligibility: async () => { throw Object.assign(new Error('unavailable'), { statusCode: 503 }) },
    error: () => {},
    logResultNotificationFailure: (_message, detail) => { resultLogged.push(detail) }
  })
  assert.equal(workflowResultNotificationPublishFailures(), before + 1)

  await deliverWorkflowRuntimeNotifications({} as H3Event, [notificationFor('workflow.instance.approved')], {
    send: async () => {},
    loadActionTargetCatalog: async () => ({ ...actionTargetCatalog, applications: actionTargetCatalog.applications.filter(app => app.appCode !== 'workflow') }),
    checkEligibility: allowEligibility,
    error: () => {},
    logResultNotificationFailure: (_message, detail) => { resultLogged.push(detail) }
  })
  assert.equal(workflowResultNotificationPublishFailures(), before + 2)
  assert.equal(resultLogged.length, 2)
  assert.equal((resultLogged[0] as { causeStatus?: number, causeCode?: string }).causeStatus, 503)
  assert.equal((resultLogged[0] as { causeCode?: string }).causeCode, 'unavailable')
  assert.equal((resultLogged[1] as { causeCode?: string }).causeCode, 'workflow_action_target_host_not_deployed')
})
