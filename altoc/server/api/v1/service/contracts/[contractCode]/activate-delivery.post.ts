import { createError, getHeader, getRouterParam, readBody, setResponseStatus, type H3Event } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { crossAppForwardedHeaders } from '@hzy/foundation/server/utils/crossAppForwardedHeaders'
import { resolveServiceAppBaseUrl } from '@hzy/foundation/server/utils/serviceAppUrl'
import { serviceAppFetch } from '@hzy/foundation/server/utils/appServiceBinding'
import { requestServiceAccessToken } from '@hzy/foundation/server/utils/serviceOidc'
import { requirePermission } from '~~/server/utils/checkPermission'
import { ensureAltocConsoleAuth, getRequestUid } from '~~/server/utils/authIdentity'
import { resolveCurrentAltocDataAccessQuery } from '~~/server/utils/altocScopedAuthorization'
import { executeContractActivationOperationsForRequest } from '~~/server/utils/contractActivationOperationRequest'
import { expectedContractActivationOperationsSucceeded, selectContractActivationProjectForLine } from '~~/server/utils/contractActivationOperation'

interface ConsoleAuthContext {
  authenticated?: boolean
  tokenUse?: string
  subjectType?: string
  appCode?: string
  clientCode?: string
  uid?: string
  subjectCode?: string
  scopes?: string[]
}

interface RuntimeEnvelope<T> {
  code?: number
  data?: T
  message?: string
}

interface ActivateDeliveryData {
  contract?: Record<string, unknown>
  paymentTerms?: Array<Record<string, unknown>>
  receivablePlans?: Array<Record<string, unknown>>
  obligations?: Array<Record<string, unknown>>
  billingSchedules?: Array<Record<string, unknown>>
  deliveryAssetPlans?: Array<Record<string, unknown>>
  serviceAgreements?: Array<Record<string, unknown>>
  createdReceivablePlans?: number
  statusChanged?: boolean
  idempotent?: boolean
  integrationOperations?: Array<Record<string, unknown>>
}

interface AimsProjectData {
  project?: Record<string, unknown>
  created?: boolean
  idempotent?: boolean
}

interface ActivationJobData {
  id?: number | string
  code?: string
  status?: string
  steps?: Array<Record<string, unknown>>
}

interface AssetsDeliveryAssetsData {
  items?: Array<Record<string, unknown>>
  total?: number
  created?: number
  updated?: number
  idempotent?: boolean
}

function text(value: unknown) {
  return String(value || '').trim()
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '')
}

function appendPath(baseUrl: string, path: string) {
  return `${trimTrailingSlash(baseUrl)}/${path.replace(/^\/+/, '')}`
}

function objectBody(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  return {}
}

function sourceApp(auth: ConsoleAuthContext) {
  return String(auth.appCode || auth.clientCode || '').trim().replace(/\.runtime$/, '')
}

function hasActivateDeliveryServiceScope(scopes: string[] = []) {
  const scopeSet = new Set(scopes)
  return scopeSet.has('altoc:*')
    || scopeSet.has('altoc:admin')
    || scopeSet.has('altoc.admin')
    || scopeSet.has('altoc:write')
    || scopeSet.has('altoc.write')
    || scopeSet.has('altoc:contract:edit')
    || scopeSet.has('altoc:contract:admin')
}

function trustedActorUid(event: H3Event) {
  const uid = getRequestUid(event)
  if (uid) return uid

  const auth = event.context.consoleAuth as ConsoleAuthContext | undefined
  if (auth?.tokenUse === 'service' || auth?.subjectType === 'service') {
    return text(auth.subjectCode || `service:${sourceApp(auth) || 'unknown'}`)
  }
  return 'system'
}

function isTrustedServiceAuth(event: H3Event) {
  const auth = event.context.consoleAuth as ConsoleAuthContext | undefined
  return auth?.tokenUse === 'service' || auth?.subjectType === 'service'
}

async function resolveActivateDeliveryDataAccessQuery(event: H3Event, actorUid: string) {
  if (isTrustedServiceAuth(event)) {
    return {
      current_user: actorUid,
      operator_uid: actorUid,
      current_user_altoc_access: 'all',
      current_user_data_access: 'all'
    }
  }
  return resolveCurrentAltocDataAccessQuery(event, 'contract', 'edit')
}

async function requireActivateDeliveryAccess(event: H3Event) {
  const auth = await ensureAltocConsoleAuth(event) as ConsoleAuthContext | undefined
  if (auth?.tokenUse === 'service' || auth?.subjectType === 'service') {
    if (!auth.authenticated || auth.tokenUse !== 'service' || auth.subjectType !== 'service') {
      throw createError({ statusCode: 401, message: 'Console service token is required.' })
    }
    if (!hasActivateDeliveryServiceScope(auth.scopes || [])) {
      throw createError({ statusCode: 403, message: 'Missing required service scope: altoc:contract:edit' })
    }
    if (!['altoc', 'workflow'].includes(sourceApp(auth))) {
      throw createError({ statusCode: 403, message: 'Service caller is not allowed for this endpoint.' })
    }
    return
  }

  await requirePermission(event, 'contract', 'edit')
}

function recordValue(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  if (typeof value === 'string' && value.trim()) {
    try {
      return objectBody(JSON.parse(value))
    } catch {
      return {}
    }
  }
  return {}
}

function resolveAssetsBaseUrl(event: H3Event) {
  const baseUrl = resolveServiceAppBaseUrl(event, 'assets')
  if (!baseUrl) {
    throw createError({ statusCode: 503, message: 'Assets service API base URL is not configured.' })
  }
  return baseUrl
}

async function callAltocRuntime<T>(
  event: H3Event,
  path: string,
  body: Record<string, unknown>,
  query: Record<string, unknown>
) {
  const runtime = await maybeCallTenantRuntime<RuntimeEnvelope<T>>(event, path, {
    appCode: 'altoc',
    scope: 'altoc.write altoc:contract:edit',
    method: 'POST',
    query,
    body
  })
  if (!runtime.handled) {
    throw createError({ statusCode: 503, message: 'Altoc tenant-runtime is required for this operation.' })
  }
  if (runtime.data.code !== undefined && runtime.data.code !== 0) {
    throw createError({ statusCode: 502, message: runtime.data.message || 'Altoc tenant-runtime returned an error.' })
  }
  return runtime.data.data as T
}

function activationJobID(job: ActivationJobData) {
  const value = text(job.id || job.code)
  if (!value) {
    throw createError({ statusCode: 502, message: 'Altoc activation job response did not include an id.' })
  }
  return value
}

function activationJobHasStep(job: ActivationJobData, stepKey: string) {
  return Array.isArray(job.steps) && job.steps.some(step => text(step.step_key || step.stepKey) === stepKey)
}

function projectFromResult(result: Record<string, unknown>) {
  return recordValue(result.project)
}

function firstProjectResult(projectResults: Array<Record<string, unknown>>) {
  return projectResults.find(item => text(projectFromResult(item).project_code || projectFromResult(item).projectCode)) || {}
}

async function recordActivationStep(
  event: H3Event,
  contractCode: string,
  job: ActivationJobData,
  stepKey: string,
  status: string,
  result: Record<string, unknown> = {},
  message = '',
  query: Record<string, unknown> = {}
) {
  if (!activationJobHasStep(job, stepKey)) return job
  return await callAltocRuntime<ActivationJobData>(
    event,
    `/v1/altoc/contracts/${encodeURIComponent(contractCode)}/activation/jobs/${encodeURIComponent(activationJobID(job))}/steps/${encodeURIComponent(stepKey)}/result`,
    {
      status,
      result,
      message
    },
    query
  )
}

async function callAssetsService<T>(
  event: H3Event,
  path: string,
  body: Record<string, unknown>,
  idempotencyKey: string
) {
  const token = await requestServiceAccessToken({
    audience: 'assets',
    scope: 'assets:write',
    event
  })
  const response = await serviceAppFetch<RuntimeEnvelope<T>>(event, 'assets', appendPath(resolveAssetsBaseUrl(event), path), {
    method: 'POST',
    headers: {
      ...crossAppForwardedHeaders(event, { idempotencyKey: idempotencyKey }),
      'authorization': `Bearer ${token}`,
      'content-type': 'application/json'
    },
    body,
    timeout: 10000
  })

  if (response.code !== undefined && response.code !== 0) {
    throw createError({ statusCode: 502, message: response.message || 'Assets service API returned an error.' })
  }
  return response.data as T
}

function deliveryAssetPayload(plan: Record<string, unknown>, contract: Record<string, unknown>, project: Record<string, unknown>, idempotencyKey: string) {
  return {
    deliveryAssetCode: plan.external_asset_code,
    sourcePlanCode: plan.code,
    customerCode: plan.customer_code || contract.customer_code,
    contractCode: plan.source_contract_code || contract.code,
    contractLineCode: plan.source_contract_line_code,
    obligationCode: plan.source_obligation_code,
    projectCode: plan.source_project_code || project.project_code || project.projectCode,
    name: plan.name,
    productCode: plan.product_code,
    productName: plan.name,
    productVersion: plan.product_version,
    catalogItemCode: plan.catalog_item_code,
    productOrigin: plan.product_origin,
    assetKind: plan.asset_kind || plan.product_origin || 'software',
    deploymentMode: plan.deployment_mode,
    instanceKey: plan.instance_key,
    tenantKey: plan.tenant_key,
    environmentCode: plan.environment_code,
    licenseModel: plan.license_model,
    licenseQuantity: plan.license_quantity,
    capacity: plan.capacity,
    unit: plan.unit,
    status: plan.status || 'planned',
    plannedDeliveryAt: plan.planned_delivery_at,
    deliveredAt: plan.delivered_at,
    goLiveAt: plan.go_live_at,
    acceptedAt: plan.accepted_at,
    expiredAt: plan.expired_at,
    terminatedAt: plan.terminated_at,
    warrantyStartAt: plan.warranty_start_at,
    warrantyEndAt: plan.warranty_end_at,
    supportExpiryAt: plan.support_expiry_at,
    sourceApp: 'altoc',
    sourceBizCode: contract.code,
    idempotencyKey
  }
}

export default defineEventHandler(async (event) => {
  const contractCode = text(getRouterParam(event, 'contractCode'))
  if (!contractCode) {
    throw createError({ statusCode: 400, message: 'contractCode is required' })
  }

  await requireActivateDeliveryAccess(event)
  const actorUid = trustedActorUid(event)
  const body = objectBody(await readBody(event))
  const dataAccessQuery = await resolveActivateDeliveryDataAccessQuery(event, actorUid)
  const incomingKey = text(getHeader(event, 'idempotency-key'))
  const baseKey = incomingKey || `altoc:contract:${contractCode}:activate-delivery:v1`
  const operationBody = {
    ...body,
    operatorUid: actorUid,
    operator_uid: actorUid,
    current_user: actorUid
  }
  let activationJob = await callAltocRuntime<ActivationJobData>(
    event,
    `/v1/altoc/contracts/${encodeURIComponent(contractCode)}/activation/execute`,
    {
      ...operationBody,
      idempotencyKey: baseKey
    },
    dataAccessQuery
  )

  let activated: ActivateDeliveryData
  try {
    activated = await callAltocRuntime<ActivateDeliveryData>(
      event,
      `/v1/altoc/service/contracts/${encodeURIComponent(contractCode)}/activate-delivery`,
      {
        ...operationBody,
        idempotencyKey: baseKey
      },
      dataAccessQuery
    )
    activationJob = await recordActivationStep(event, contractCode, activationJob, 'altoc_activate_contract', 'succeeded', {
      contract: activated.contract,
      createdReceivablePlans: activated.createdReceivablePlans || 0,
      statusChanged: activated.statusChanged === true,
      idempotent: activated.idempotent === true
    }, '', dataAccessQuery)
    activationJob = await recordActivationStep(event, contractCode, activationJob, 'altoc_receivable_plan', 'succeeded', {
      receivablePlans: activated.receivablePlans || [],
      createdReceivablePlans: activated.createdReceivablePlans || 0
    }, '', dataAccessQuery)
  } catch (error) {
    await recordActivationStep(event, contractCode, activationJob, 'altoc_activate_contract', 'failed', {}, error instanceof Error ? error.message : String(error || 'activate delivery failed'), dataAccessQuery)
    throw error
  }

  const contract = activated.contract || {}
  const frozenOperations = activated.integrationOperations || []
  const activationOperationResults = frozenOperations.length > 0
    ? await executeContractActivationOperationsForRequest(event, frozenOperations, dataAccessQuery)
    : []
  const projectResults: Array<Record<string, unknown>> = activationOperationResults
    .filter(item => text(item.operationCode) === 'altoc.contract-activation.aims-project.v1')
    .map(item => ({
      project: { project_code: item.projectCode, ...recordValue(recordValue(item.result).project) },
      ...recordValue(item.result), planKey: item.planKey, projectRole: item.projectRole,
      lineCodes: item.lineCodes, obligationCodes: item.obligationCodes, operation: item
    }))
  const milestoneItems = activationOperationResults
    .filter(item => text(item.operationCode) === 'altoc.contract-activation.aims-milestones.v1')
    .map(item => ({ ...recordValue(item.result), planKey: item.planKey, operation: item }))
  const projectData = (projectResults[0] as AimsProjectData | undefined) || {}
  const project = projectFromResult(firstProjectResult(projectResults))
  const milestoneData = { items: milestoneItems, total: milestoneItems.length }
  const expectsProjects = activationJobHasStep(activationJob, 'aims_project_link')
  const projectOperationsSucceeded = expectedContractActivationOperationsSucceeded(
    expectsProjects, 'altoc.contract-activation.aims-project.v1', activationOperationResults
  )
  if (activationJobHasStep(activationJob, 'aims_project_link') && projectOperationsSucceeded) {
    activationJob = await recordActivationStep(event, contractCode, activationJob, 'aims_project_link', 'succeeded', {
      projects: projectResults,
      created: projectResults.filter(item => item.created === true).length,
      idempotent: projectResults.every(item => item.idempotent === true)
    }, '', dataAccessQuery)
  }
  const expectsMilestones = activationJobHasStep(activationJob, 'aims_payment_milestones_sync')
  const milestoneOperationsSucceeded = expectedContractActivationOperationsSucceeded(
    expectsMilestones, 'altoc.contract-activation.aims-milestones.v1', activationOperationResults
  )
  if (expectsMilestones && milestoneOperationsSucceeded) {
    activationJob = await recordActivationStep(event, contractCode, activationJob, 'aims_payment_milestones_sync', 'succeeded', milestoneData, '', dataAccessQuery)
  }
  const aimsOperationsSucceeded = projectOperationsSucceeded && milestoneOperationsSucceeded

  let deliveryAssetData: AssetsDeliveryAssetsData = {}
  if (activationJobHasStep(activationJob, 'assets_delivery_assets_plan') && aimsOperationsSucceeded) {
    const deliveryAssetPlans = activated.deliveryAssetPlans || []
    const assetsKey = `altoc:contract:${contractCode}:customer-delivery-assets:v1`
    try {
      deliveryAssetData = await callAssetsService<AssetsDeliveryAssetsData>(
        event,
        '/api/v1/service/customer-delivery-assets/plans',
        {
          contractCode,
          customerCode: contract.customer_code,
          deliveryAssets: deliveryAssetPlans.map((plan) => {
            const lineCode = text(plan.source_contract_line_code || plan.contract_line_code || plan.contractLineCode)
            const projectResult = selectContractActivationProjectForLine(lineCode, projectResults)
            return deliveryAssetPayload(plan, contract, projectFromResult(projectResult), assetsKey)
          }),
          idempotencyKey: assetsKey
        },
        assetsKey
      )
      activationJob = await recordActivationStep(event, contractCode, activationJob, 'assets_delivery_assets_plan', 'succeeded', {
        ...deliveryAssetData,
        localPlans: deliveryAssetPlans.length
      }, '', dataAccessQuery)
    } catch (error) {
      await recordActivationStep(event, contractCode, activationJob, 'assets_delivery_assets_plan', 'failed', {}, error instanceof Error ? error.message : String(error || 'Assets customer delivery asset sync failed'), dataAccessQuery)
      throw error
    }
  }

  const activationOperationsPending = !aimsOperationsSucceeded
    || activationOperationResults.some(item => item.succeeded !== true)
  if (activationOperationsPending) setResponseStatus(event, 202)
  // 合同状态与回款计划在 activateContractDelivery 的事务里已经提交，而 Aims
  // 交付项目/里程碑走的是可靠命令投递，可能尚未成功。若响应只有 code:0，
  // 调用方无法区分「自动编排真的跑通了」和「经营侧已生效但交付侧什么都没有」
  // ——生产上前端正是据此弹绿色成功（走查 ISSUE-B-005）。
  const pendingOperations = activationOperationResults.filter(item => item.succeeded !== true)
  return {
    code: 0,
    message: 'ok',
    data: {
      contract,
      project,
      projects: projectResults,
      projectCreated: projectData.created === true,
      deliveryOrchestrated: !activationOperationsPending,
      deliveryPending: activationOperationsPending,
      pendingOperationCount: pendingOperations.length,
      pendingOperationCodes: pendingOperations.map(item => text(item.operationCode)).filter(Boolean),
      createdReceivablePlans: activated.createdReceivablePlans || 0,
      receivablePlans: activated.receivablePlans || [],
      customerDeliveryAssets: deliveryAssetData.items || [],
      paymentMilestones: milestoneData,
      integrationOperations: activationOperationResults,
      activationJob,
      idempotent: activated.idempotent === true
        && activationOperationResults.every(item => item.succeeded === true)
        && (!activationJobHasStep(activationJob, 'assets_delivery_assets_plan') || deliveryAssetData.idempotent === true)
    }
  }
})
