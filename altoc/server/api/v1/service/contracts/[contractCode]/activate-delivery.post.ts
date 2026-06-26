import { createError, getHeader, getRouterParam, readBody, type H3Event } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { resolveServiceAppBaseUrl } from '@hzy/foundation/server/utils/serviceAppUrl'
import { requestServiceAccessToken } from '@hzy/foundation/server/utils/serviceOidc'
import { requirePermission } from '~~/server/utils/checkPermission'
import { getRequestUid } from '~~/server/utils/authIdentity'

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

function recordArray(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    return value.filter(item => item && typeof item === 'object' && !Array.isArray(item)) as Array<Record<string, unknown>>
  }
  if (typeof value === 'string' && value.trim()) {
    try {
      return recordArray(JSON.parse(value))
    } catch {
      return []
    }
  }
  return []
}

function textArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(item => text(item)).filter(Boolean)
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value)
      if (Array.isArray(parsed)) return parsed.map(item => text(item)).filter(Boolean)
    } catch {
      return [text(value)].filter(Boolean)
    }
  }
  return []
}

function forwardedContextHeaders(event: H3Event, idempotencyKey: string) {
  const headers: Record<string, string> = {}
  for (const name of [
    'x-hzy-gateway',
    'x-hzy-gateway-token',
    'x-hzy-tenant',
    'x-hzy-deployment',
    'x-hzy-environment',
    'x-hzy-tenant-runtime-url',
    'x-hzy-tenant-runtime-token',
    'x-hzy-tenant-runtime-audience',
    'x-hzy-data-runtime-url',
    'x-hzy-data-runtime-token',
    'x-hzy-data-runtime-audience',
    'x-forwarded-host',
    'x-forwarded-port',
    'x-forwarded-prefix',
    'x-forwarded-proto'
  ]) {
    const value = text(getHeader(event, name))
    if (value) headers[name] = value
  }

  const requestId = text(getHeader(event, 'x-request-id') || getHeader(event, 'x-correlation-id'))
  if (requestId) headers['x-request-id'] = requestId
  if (idempotencyKey) headers['idempotency-key'] = idempotencyKey
  return headers
}

function resolveAimsBaseUrl(event: H3Event) {
  const baseUrl = resolveServiceAppBaseUrl(event, 'aims')
  if (!baseUrl) {
    throw createError({ statusCode: 503, message: 'Aims service API base URL is not configured.' })
  }
  return baseUrl
}

function resolveAssetsBaseUrl(event: H3Event) {
  const baseUrl = resolveServiceAppBaseUrl(event, 'assets')
  if (!baseUrl) {
    throw createError({ statusCode: 503, message: 'Assets service API base URL is not configured.' })
  }
  return baseUrl
}

async function callAltocRuntime<T>(event: H3Event, path: string, body: Record<string, unknown>) {
  const runtime = await maybeCallTenantRuntime<RuntimeEnvelope<T>>(event, path, {
    appCode: 'altoc',
    scope: 'altoc.write altoc:contract:edit',
    method: 'POST',
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

function activationStepRequest(job: ActivationJobData, stepKey: string) {
  const step = (job.steps || []).find(item => text(item.step_key || item.stepKey) === stepKey)
  return recordValue(step?.request_snapshot || step?.requestSnapshot)
}

function activationProjectPlans(job: ActivationJobData) {
  const request = activationStepRequest(job, 'aims_project_link')
  const plans = recordArray(request.project_plans || request.projectPlans)
  if (plans.length > 0) return plans
  const lineCodes = textArray(request.line_codes || request.lineCodes)
  if (lineCodes.length === 0) return []
  return [{
    plan_key: request.plan_key || request.planKey || 'delivery-main',
    project_role: request.project_role || request.projectRole || 'delivery',
    project_code: request.project_code || request.projectCode,
    project_name: request.project_name || request.projectName,
    line_codes: lineCodes,
    obligation_codes: textArray(request.obligation_codes || request.obligationCodes),
    action: request.action || 'create_or_link'
  }]
}

function planKey(plan: Record<string, unknown>, index = 0) {
  return text(plan.plan_key || plan.planKey || `project-${index + 1}`)
}

function planLineCodes(plan: Record<string, unknown>) {
  return textArray(plan.line_codes || plan.lineCodes)
}

function planObligationCodes(plan: Record<string, unknown>) {
  return textArray(plan.obligation_codes || plan.obligationCodes)
}

function projectFromResult(result: Record<string, unknown>) {
  return recordValue(result.project)
}

function firstProjectResult(projectResults: Array<Record<string, unknown>>) {
  return projectResults.find(item => text(projectFromResult(item).project_code || projectFromResult(item).projectCode)) || {}
}

function scheduleMatchesPlan(schedule: Record<string, unknown>, plan: Record<string, unknown>) {
  const lineCodes = new Set(planLineCodes(plan))
  const obligationCodes = new Set(planObligationCodes(plan))
  const scheduleLineCode = text(schedule.contract_line_code || schedule.contractLineCode)
  const scheduleObligationCode = text(schedule.obligation_code || schedule.obligationCode)
  if (!scheduleLineCode && !scheduleObligationCode) return true
  return (scheduleLineCode && lineCodes.has(scheduleLineCode)) || (scheduleObligationCode && obligationCodes.has(scheduleObligationCode))
}

function billingSchedulesForPlan(schedules: Array<Record<string, unknown>>, plan: Record<string, unknown>) {
  return schedules.filter(schedule => scheduleMatchesPlan(schedule, plan))
}

function paymentTermsForPlan(terms: Array<Record<string, unknown>>, schedules: Array<Record<string, unknown>>, plan: Record<string, unknown>, index: number) {
  const scopedSchedules = billingSchedulesForPlan(schedules, plan)
  if (schedules.length === 0 || scopedSchedules.some(schedule => !text(schedule.contract_line_code || schedule.contractLineCode))) {
    return index === 0 ? terms : []
  }
  return index === 0 ? terms.filter(term => text(term.trigger_stage_type || term.triggerStageType) === 'contract_signed') : []
}

function projectResultForLine(lineCode: string, projectResults: Array<Record<string, unknown>>) {
  return projectResults.find(result => textArray(result.lineCodes || result.line_codes).includes(lineCode)) || firstProjectResult(projectResults)
}

async function recordActivationStep(
  event: H3Event,
  contractCode: string,
  job: ActivationJobData,
  stepKey: string,
  status: string,
  result: Record<string, unknown> = {},
  message = ''
) {
  if (!activationJobHasStep(job, stepKey)) return job
  return await callAltocRuntime<ActivationJobData>(
    event,
    `/v1/altoc/contracts/${encodeURIComponent(contractCode)}/activation/jobs/${encodeURIComponent(activationJobID(job))}/steps/${encodeURIComponent(stepKey)}/result`,
    {
      status,
      result,
      message
    }
  )
}

async function callAimsService<T>(
  event: H3Event,
  path: string,
  body: Record<string, unknown>,
  idempotencyKey: string
) {
  const token = await requestServiceAccessToken({
    audience: 'aims',
    scope: 'aims:write',
    event
  })
  const response = await $fetch<RuntimeEnvelope<T>>(appendPath(resolveAimsBaseUrl(event), path), {
    method: 'POST',
    headers: {
      ...forwardedContextHeaders(event, idempotencyKey),
      'authorization': `Bearer ${token}`,
      'content-type': 'application/json'
    },
    body,
    timeout: 10000
  })

  if (response.code !== undefined && response.code !== 0) {
    throw createError({ statusCode: 502, message: response.message || 'Aims service API returned an error.' })
  }
  return response.data as T
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
  const response = await $fetch<RuntimeEnvelope<T>>(appendPath(resolveAssetsBaseUrl(event), path), {
    method: 'POST',
    headers: {
      ...forwardedContextHeaders(event, idempotencyKey),
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

function projectPayload(contract: Record<string, unknown>, body: Record<string, unknown>, plan: Record<string, unknown> = {}) {
  const projectRole = text(plan.project_role || plan.projectRole || 'delivery')
  return {
    contractCode: contract.code,
    contractId: contract.id,
    contractName: contract.name,
    projectName: plan.project_name || plan.projectName || body.projectName || contract.name,
    projectCode: plan.project_code || plan.projectCode || body.projectCode,
    projectRole,
    planKey: plan.plan_key || plan.planKey,
    lineCodes: textArray(plan.line_codes || plan.lineCodes),
    obligationCodes: textArray(plan.obligation_codes || plan.obligationCodes),
    customerCode: contract.customer_code,
    customerName: contract.customer_name,
    oppId: contract.opportunity_id,
    opportunityCode: contract.opportunity_code,
    ownerUserId: contract.owner_user_id,
    ownerDeptCode: contract.owner_dept_code,
    category: projectRole === 'maintenance' ? 'maintenance' : 'delivery',
    effectiveDate: contract.effective_date,
    startDate: contract.effective_date,
    endDate: contract.end_date,
    createdBy: body.operatorUid || body.operator_uid || body.current_user
  }
}

function paymentTermPayload(term: Record<string, unknown>) {
  return {
    ...term,
    paymentTermId: term.id,
    termName: term.term_name,
    termType: term.term_type,
    billingMode: term.billing_mode,
    amount: term.amount,
    ratio: term.ratio,
    conditionDesc: term.condition_desc,
    triggerStageType: term.trigger_stage_type,
    expectedDate: term.expected_date,
    plannedPaymentDate: term.planned_payment_date,
    receivablePlanCode: term.receivable_plan_code
  }
}

function billingSchedulePayload(schedule: Record<string, unknown>) {
  return {
    ...schedule,
    billingScheduleId: schedule.id,
    billingScheduleCode: schedule.code,
    scheduleName: schedule.name,
    triggerType: schedule.trigger_type,
    amount: schedule.amount,
    expectedDate: schedule.expected_date,
    contractLineCode: schedule.contract_line_code,
    obligationCode: schedule.obligation_code,
    obligationName: schedule.obligation_name,
    financePlanCode: schedule.finance_plan_code
  }
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

  await requirePermission(event, 'contract', 'edit')
  const actorUid = getRequestUid(event)
  const body = objectBody(await readBody(event))
  const incomingKey = text(getHeader(event, 'idempotency-key'))
  const baseKey = incomingKey || `altoc:contract:${contractCode}:activate-delivery:v1`
  const operationBody = {
    ...body,
    operatorUid: body.operatorUid || body.operator_uid || actorUid,
    current_user: body.current_user || actorUid
  }
  let activationJob = await callAltocRuntime<ActivationJobData>(
    event,
    `/v1/altoc/contracts/${encodeURIComponent(contractCode)}/activation/execute`,
    {
      ...operationBody,
      idempotencyKey: baseKey
    }
  )

  let activated: ActivateDeliveryData
  try {
    activated = await callAltocRuntime<ActivateDeliveryData>(
      event,
      `/v1/altoc/service/contracts/${encodeURIComponent(contractCode)}/activate-delivery`,
      {
        ...operationBody,
        idempotencyKey: baseKey
      }
    )
    activationJob = await recordActivationStep(event, contractCode, activationJob, 'altoc_activate_contract', 'succeeded', {
      contract: activated.contract,
      createdReceivablePlans: activated.createdReceivablePlans || 0,
      statusChanged: activated.statusChanged === true,
      idempotent: activated.idempotent === true
    })
    activationJob = await recordActivationStep(event, contractCode, activationJob, 'altoc_receivable_plan', 'succeeded', {
      receivablePlans: activated.receivablePlans || [],
      createdReceivablePlans: activated.createdReceivablePlans || 0
    })
  } catch (error) {
    await recordActivationStep(event, contractCode, activationJob, 'altoc_activate_contract', 'failed', {}, error instanceof Error ? error.message : String(error || 'activate delivery failed'))
    throw error
  }

  const contract = activated.contract || {}
  let projectData: AimsProjectData = {}
  const projectResults: Array<Record<string, unknown>> = []
  let project: Record<string, unknown> = {}
  let milestoneData: Record<string, unknown> = {}
  if (activationJobHasStep(activationJob, 'aims_project_link')) {
    const projectPlans = activationProjectPlans(activationJob)
    try {
      for (const [index, plan] of projectPlans.entries()) {
        const key = planKey(plan, index)
        const projectKey = `altoc:contract:${contractCode}:project-link:${key}:v1`
        const result = await callAimsService<AimsProjectData>(
          event,
          '/api/v1/service/projects/from-contract',
          {
            ...projectPayload(contract, operationBody, plan),
            idempotencyKey: projectKey
          },
          projectKey
        )
        projectResults.push({
          ...result,
          plan,
          planKey: key,
          projectRole: plan.project_role || plan.projectRole || 'delivery',
          lineCodes: planLineCodes(plan),
          obligationCodes: planObligationCodes(plan)
        })
      }
      projectData = (projectResults[0] as AimsProjectData | undefined) || {}
      activationJob = await recordActivationStep(event, contractCode, activationJob, 'aims_project_link', 'succeeded', {
        projects: projectResults,
        created: projectResults.filter(item => item.created === true).length,
        idempotent: projectResults.every(item => item.idempotent === true)
      })
    } catch (error) {
      await recordActivationStep(event, contractCode, activationJob, 'aims_project_link', 'failed', {}, error instanceof Error ? error.message : String(error || 'Aims project activation failed'))
      throw error
    }

    project = projectFromResult(firstProjectResult(projectResults))
    const projectCode = text(project.project_code || project.projectCode)
    if (!projectCode) {
      await recordActivationStep(event, contractCode, activationJob, 'aims_project_link', 'failed', { projects: projectResults }, 'Aims project response did not include project_code.')
      throw createError({ statusCode: 502, message: 'Aims project response did not include project_code.' })
    }

    try {
      const milestoneItems: Array<Record<string, unknown>> = []
      for (const [index, result] of projectResults.entries()) {
        const resultProject = projectFromResult(result)
        const resultProjectCode = text(resultProject.project_code || resultProject.projectCode)
        if (!resultProjectCode) continue
        const plan = recordValue(result.plan)
        const key = text(result.planKey) || planKey(plan, index)
        const syncKey = `altoc:contract:${contractCode}:payment-terms:${key}:v1`
        const paymentTerms = paymentTermsForPlan(activated.paymentTerms || [], activated.billingSchedules || [], plan, index)
        const billingSchedules = billingSchedulesForPlan(activated.billingSchedules || [], plan)
        if (paymentTerms.length === 0 && billingSchedules.length === 0) continue
        const syncResult = await callAimsService<Record<string, unknown>>(
          event,
          `/api/v1/service/projects/${encodeURIComponent(resultProjectCode)}/payment-milestones:sync`,
          {
            contractCode,
            projectPlanKey: key,
            projectRole: result.projectRole,
            paymentTerms: paymentTerms.map(paymentTermPayload),
            billingSchedules: billingSchedules.map(billingSchedulePayload),
            idempotencyKey: syncKey
          },
          syncKey
        )
        milestoneItems.push({
          projectCode: resultProjectCode,
          planKey: key,
          ...syncResult
        })
      }
      milestoneData = { items: milestoneItems, total: milestoneItems.length }
      activationJob = await recordActivationStep(event, contractCode, activationJob, 'aims_payment_milestones_sync', 'succeeded', milestoneData)
    } catch (error) {
      await recordActivationStep(event, contractCode, activationJob, 'aims_payment_milestones_sync', 'failed', {}, error instanceof Error ? error.message : String(error || 'Aims milestone sync failed'))
      throw error
    }
  }

  let deliveryAssetData: AssetsDeliveryAssetsData = {}
  if (activationJobHasStep(activationJob, 'assets_delivery_assets_plan')) {
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
            const projectResult = projectResultForLine(lineCode, projectResults)
            return deliveryAssetPayload(plan, contract, projectFromResult(projectResult), assetsKey)
          }),
          idempotencyKey: assetsKey
        },
        assetsKey
      )
      activationJob = await recordActivationStep(event, contractCode, activationJob, 'assets_delivery_assets_plan', 'succeeded', {
        ...deliveryAssetData,
        localPlans: deliveryAssetPlans.length
      })
    } catch (error) {
      await recordActivationStep(event, contractCode, activationJob, 'assets_delivery_assets_plan', 'failed', {}, error instanceof Error ? error.message : String(error || 'Assets customer delivery asset sync failed'))
      throw error
    }
  }

  return {
    code: 0,
    message: 'ok',
    data: {
      contract,
      project,
      projects: projectResults,
      projectCreated: projectData.created === true,
      createdReceivablePlans: activated.createdReceivablePlans || 0,
      receivablePlans: activated.receivablePlans || [],
      customerDeliveryAssets: deliveryAssetData.items || [],
      paymentMilestones: milestoneData,
      activationJob,
      idempotent: activated.idempotent === true
        && (!activationJobHasStep(activationJob, 'aims_project_link') || projectResults.every(item => item.idempotent === true))
        && (!activationJobHasStep(activationJob, 'assets_delivery_assets_plan') || deliveryAssetData.idempotent === true)
    }
  }
})
