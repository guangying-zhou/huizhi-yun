import { createError, type H3Event } from 'h3'
import {
  requestWithServiceAccessToken,
  trustedServiceRequestHeaders
} from '@hzy/foundation/server/utils/serviceOidc'
import { getConsoleUserNotificationDetailFact } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import { resolveServiceAppBaseUrl } from '@hzy/foundation/server/utils/serviceAppUrl'
import { fetchExternal } from '@hzy/foundation/server/utils/externalFetch'
import { resolveConsoleRuntimeBinding } from './consoleRuntimeBinding'
import { authorizeConsoleLifecycleNotificationDetail } from './consoleLifecycleNotificationDetailAuthorization'
import { loadNotificationDetailDepartmentTree } from './notificationDetailDepartmentScope'
import { evaluateWithFreshNotificationDetailPolicy } from './notificationDetailFreshPolicy'
import { loadPolicyScopedAuthorization } from './policyScopedAuthorization'
import { evaluateSubjectEligibility } from './subjectEligibility'
import { notificationDetailEligibilityTarget } from './subjectEligibilityContract'
import {
  authorizeNotificationDetailAfterFreshEligibility,
  IntegrationOperationDetailEligibilityError
} from './integrationOperationNotificationDetailEligibility'
import {
  notificationAuthorizationDescriptor,
  notificationDetailSourceAuthorizationTarget,
  notificationDetailResponse,
  type NotificationAuthorizationDescriptor,
  type NotificationDetailFact
} from './notificationDetailContract'
import {
  authorizeNotificationDetail as enforceNotificationDetailAuthorization,
  NotificationDetailAuthorizationPolicyError,
  type NotificationDetailAuthorizationChallenge,
  type NotificationDetailFinalizeBinding
} from './notificationDetailAuthorizationPolicy'
import { normalizePortalNotificationActionUrl, PortalNotificationPublishError } from './portalNotificationIdempotency'

const AUTHORIZATION_PATH = '/api/v1/service/notification-details/authorize'
const AUTHORIZATION_FINALIZE_PATH = '/api/v1/service/notification-details/authorize/finalize'

type NotificationDetailRow = NotificationDetailFact

export interface ConsoleNotificationDetailAuthorizationRequest {
  notificationId: string
  descriptor: NotificationAuthorizationDescriptor
  subject: { uid: string }
  tenantId: string
  deploymentId: string
}

export interface ConsoleNotificationDetailAuthorizationResponse {
  authorized?: unknown
  resource?: unknown
  id?: unknown
  reason?: unknown
  reasonCode?: unknown
  authorizationChallenge?: unknown
  authorizationEvidence?: unknown
}

interface ConsoleNotificationDetailAuthorizationEnvelope {
  code?: unknown
  data?: ConsoleNotificationDetailAuthorizationResponse
}

type NotificationDetailFetch = (
  url: string,
  options: {
    method: 'POST'
    headers: Record<string, string>
    body: Record<string, unknown>
    timeout: number
  }
) => Promise<ConsoleNotificationDetailAuthorizationEnvelope>

export interface ConsoleNotificationDetailAuthorizationVerifierInput {
  event: H3Event
  sourceAppCode: string
  request: ConsoleNotificationDetailAuthorizationRequest
}

interface ConsoleNotificationDetailAuthorizationDependencies {
  resolveBinding?: (event: H3Event) => { tenantId: string, deploymentId: string }
  evaluateEligibility?: typeof evaluateSubjectEligibility
}

export type ConsoleNotificationDetailAuthorizationVerifier = (
  input: ConsoleNotificationDetailAuthorizationVerifierInput
) => Promise<ConsoleNotificationDetailAuthorizationResponse>

const registeredVerifiers = new Map<string, ConsoleNotificationDetailAuthorizationVerifier>()

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function normalizedAppCode(value: unknown) {
  const code = stringValue(value).toLowerCase()
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(code) ? code : ''
}

function restrictedDetail() {
  return createError({
    statusCode: 403,
    message: 'Notification detail access is no longer authorized',
    data: { error: 'notification_detail_restricted' }
  })
}

function unavailableDetail() {
  return createError({
    statusCode: 503,
    message: 'Notification detail authorization is unavailable',
    data: { error: 'notification_detail_unavailable' }
  })
}

export function registerNotificationDetailAuthorizationVerifier(
  sourceAppCode: string,
  verifier: ConsoleNotificationDetailAuthorizationVerifier | null
) {
  const source = normalizedAppCode(sourceAppCode)
  if (!source) throw new Error('notification detail verifier source app code is invalid')
  if (verifier) registeredVerifiers.set(source, verifier)
  else registeredVerifiers.delete(source)
}

export function resetNotificationDetailAuthorizationVerifiersForTest() {
  registeredVerifiers.clear()
}

async function callSourceAuthorization(
  input: ConsoleNotificationDetailAuthorizationVerifierInput,
  path: string,
  body: Record<string, unknown>
) {
  const target = notificationDetailSourceAuthorizationTarget(input.sourceAppCode)
  if (!target) throw unavailableDetail()
  const baseUrl = resolveServiceAppBaseUrl(input.event, input.sourceAppCode, { directTarget: true })
  if (!baseUrl) throw unavailableDetail()
  const fetchAuthorization = fetchExternal as unknown as NotificationDetailFetch
  const envelope = await requestWithServiceAccessToken<ConsoleNotificationDetailAuthorizationEnvelope>({
    audience: target.audience,
    scope: target.scope,
    event: input.event,
    request: async token => await fetchAuthorization(
      `${baseUrl}${path}`,
      {
        method: 'POST',
        headers: {
          ...trustedServiceRequestHeaders(input.event, input.sourceAppCode),
          Authorization: `Bearer ${token}`
        },
        body,
        timeout: 5000
      }
    )
  })
  if (Number(envelope?.code) !== 0 || !envelope?.data) throw unavailableDetail()
  return envelope.data
}

async function httpAuthorizationVerifier(input: ConsoleNotificationDetailAuthorizationVerifierInput) {
  return await callSourceAuthorization(input, AUTHORIZATION_PATH, input.request as unknown as Record<string, unknown>)
}

async function httpAuthorizationFinalizer(
  input: ConsoleNotificationDetailAuthorizationVerifierInput,
  challenge: NotificationDetailAuthorizationChallenge,
  decisionBinding: NotificationDetailFinalizeBinding
) {
  return await callSourceAuthorization(input, AUTHORIZATION_FINALIZE_PATH, {
    ...input.request,
    authorizationChallenge: challenge,
    decisionBinding
  })
}

export async function authorizeConsoleNotificationDetail(
  input: ConsoleNotificationDetailAuthorizationVerifierInput,
  dependencies: ConsoleNotificationDetailAuthorizationDependencies = {}
) {
  const source = normalizedAppCode(input.sourceAppCode)
  const trustedBinding = (dependencies.resolveBinding || resolveConsoleRuntimeBinding)(input.event)
  if (
    !stringValue(input.request.notificationId)
    || !stringValue(input.request.subject?.uid)
    || input.request.tenantId !== trustedBinding.tenantId
    || input.request.deploymentId !== trustedBinding.deploymentId
  ) throw unavailableDetail()
  const target = notificationDetailSourceAuthorizationTarget(source)
  const isRecipientScopedAimsFeedback = source === 'aims'
    && input.request.descriptor.resource === 'webdev_issue'
  const verifier = registeredVerifiers.get(source)
    || (source === 'console'
      ? async () => await authorizeConsoleLifecycleNotificationDetail(
        input.event,
        input.request.subject.uid,
        input.request.descriptor
      )
      : null)
    // Feedback-created notifications are immutable message snapshots already
    // bound to the current recipient by detail-fact lookup. They intentionally
    // keep the active application (AIMS) as their source; the fresh AIMS
    // eligibility check below is their revocation boundary, while WebDev
    // re-authorizes the action target when it is opened.
    || (isRecipientScopedAimsFeedback
      ? async () => ({
        authorized: true,
        reasonCode: 'allowed',
        resource: input.request.descriptor.resource,
        id: input.request.descriptor.id
      })
      : null)
    || (target ? httpAuthorizationVerifier : null)
  const authorizeSource = async () => {
    await enforceNotificationDetailAuthorization({
      sourceAppCode: source,
      descriptor: input.request.descriptor,
      context: { ...input, sourceAppCode: source }
    }, verifier
      ? async policyInput => await verifier(policyInput.context)
      : null,
    input.request.subject.uid,
    source === 'aims'
      ? async (scopeInput) => {
        const departmentTree = scopeInput.object.departmentCode
          ? await loadNotificationDetailDepartmentTree(input.event, scopeInput.object.departmentCode)
          : undefined
        const scoped = await evaluateWithFreshNotificationDetailPolicy(
          input.event,
          trustedBinding,
          async () => await loadPolicyScopedAuthorization(
            scopeInput.subjectUid,
            'aims',
            input.event,
            {
              resourceCode: 'projects',
              action: 'admin',
              object: {
                ...scopeInput.object,
                ...(departmentTree ? { departmentTree } : {})
              },
              authorizationMode: 'merged',
              ignoreSimulationSession: true,
              allowRoleSimulation: false,
              allowUserSimulation: false,
              allowPrivileged: false,
              bypassSnapshotCache: true
            }
          )
        )
        if (!scoped.decision) throw unavailableDetail()
        return {
          allowed: scoped.decision.allowed,
          matchedScopes: scoped.decision.matchedScopes,
          policyRevision: scoped.policyRevision,
          policyBundleHash: scoped.bundleHash
        }
      }
      : null,
    source === 'aims'
      ? async (_policyInput, challenge, decisionBinding) => await httpAuthorizationFinalizer(
        { ...input, sourceAppCode: source },
        challenge,
        decisionBinding
      )
      : null)
  }
  try {
    // Console lifecycle notifications have their own two-permission boundary;
    // do not replace it with the generic source descriptor registry.
    if (source === 'console') return await authorizeSource()
    return await authorizeNotificationDetailAfterFreshEligibility({
      sourceAppCode: source,
      resource: input.request.descriptor.resource,
      eligibilityTarget: notificationDetailEligibilityTarget(source, input.request.descriptor.resource),
      evaluate: async target => await (dependencies.evaluateEligibility || evaluateSubjectEligibility)(
        input.event,
        trustedBinding,
        {
          subjectUid: input.request.subject.uid,
          targetAppCode: target.targetAppCode,
          resourceCode: target.resourceCode,
          action: target.action,
          purpose: 'notification_detail',
          tenantId: trustedBinding.tenantId,
          deploymentId: trustedBinding.deploymentId
        }
      ),
      authorizeSource
    })
  } catch (error) {
    if (error instanceof IntegrationOperationDetailEligibilityError) {
      if (error.code === 'restricted') throw restrictedDetail()
      throw unavailableDetail()
    }
    if (
      error instanceof NotificationDetailAuthorizationPolicyError
      && error.code === 'notification_detail_restricted'
    ) throw restrictedDetail()
    throw unavailableDetail()
  }
}

export async function getUserNotificationDetail(event: H3Event, uidInput: string, notificationIdInput: string) {
  const uid = stringValue(uidInput)
  const notificationId = stringValue(notificationIdInput)
  if (!notificationId) {
    throw createError({ statusCode: 400, message: 'notificationId is required' })
  }

  const envelope = await getConsoleUserNotificationDetailFact(event, notificationId)
  const row = envelope.data as unknown as NotificationDetailRow

  const descriptor = notificationAuthorizationDescriptor(row)
  if (!descriptor) throw unavailableDetail()
  const binding = resolveConsoleRuntimeBinding(event)
  await authorizeConsoleNotificationDetail({
    event,
    sourceAppCode: row.sourceAppCode,
    request: {
      notificationId: row.notificationId,
      descriptor,
      subject: { uid },
      tenantId: binding.tenantId,
      deploymentId: binding.deploymentId
    }
  })
  try {
    const actionUrl = normalizePortalNotificationActionUrl(row.actionUrl)
    return notificationDetailResponse({ ...row, actionUrl })
  } catch (error) {
    if (error instanceof PortalNotificationPublishError) throw unavailableDetail()
    throw error
  }
}
