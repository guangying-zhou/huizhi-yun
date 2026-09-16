import { createHash } from 'node:crypto'
import { requireConsoleAuthContext } from '@hzy/foundation/server/utils/consoleOidc'
import {
  hashServiceCommandPayload,
  verifyServiceCommandRuntimeHeaders
} from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { getHeader, getRequestURL, type H3Event } from 'h3'
import { callCodocsTenantRuntime } from './codocsRuntime'
import { uploadDocument } from './oss'
import {
  AIMS_COMPANY_WEEKLY_SUMMARY_PUBLISH_SERVICE_AUTH,
  requireCodocsCrossAppServiceTenantDeploymentBinding,
  requireCodocsServiceAuth
} from './serviceAuthGuard'

type RuntimeRow = Record<string, unknown>

interface CompanySummaryCommand extends RuntimeRow {
  periodKey: string
  summaryId: number
  summaryVersionId: number
  revisionNo: number
  title: string
  markdownSha256: string
  recipientUids: string[]
  documentType: 'company'
  idempotencyKey: string
  operatorUid: string
}

interface ServiceCommandEnvelope {
  operationId: string
  targetApp: string
  operationCode: string
  requiredCapability: string
  idempotencyKey: string
  commandSchemaVersion: string
  commandSha256: string
  command: CompanySummaryCommand
}

function text(value: unknown) {
  return String(value || '').trim()
}

function bearerToken(event: H3Event) {
  const match = /^Bearer\s+(.+)$/iu.exec(text(getHeader(event, 'authorization')))
  if (!match?.[1]) throw createError({ statusCode: 401, message: 'Aims service token is required.' })
  return match[1]
}

function positiveInteger(value: unknown) {
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : 0
}

function normalizeCommand(value: unknown): CompanySummaryCommand {
  const row = value && typeof value === 'object' && !Array.isArray(value)
    ? value as RuntimeRow
    : {}
  return {
    periodKey: text(row.periodKey),
    summaryId: positiveInteger(row.summaryId),
    summaryVersionId: positiveInteger(row.summaryVersionId),
    revisionNo: positiveInteger(row.revisionNo),
    title: text(row.title),
    markdownSha256: text(row.markdownSha256),
    recipientUids: Array.isArray(row.recipientUids)
      ? [...new Set(row.recipientUids.map(text).filter(Boolean))].sort()
      : [],
    documentType: text(row.documentType) as 'company',
    idempotencyKey: text(row.idempotencyKey),
    operatorUid: text(row.operatorUid)
  }
}

export async function publishAimsCompanyWeeklySummary(event: H3Event, periodKey: string) {
  const auth = await requireConsoleAuthContext(event)
  requireCodocsServiceAuth(auth, AIMS_COMPANY_WEEKLY_SUMMARY_PUBLISH_SERVICE_AUTH)
  const binding = requireCodocsCrossAppServiceTenantDeploymentBinding(
    auth,
    getHeader(event, 'x-hzy-tenant'),
    getHeader(event, 'x-hzy-deployment')
  )
  const body = await readBody<{ serviceCommand?: unknown, markdownContent?: unknown }>(event)
  const rawEnvelope = body?.serviceCommand && typeof body.serviceCommand === 'object' && !Array.isArray(body.serviceCommand)
    ? body.serviceCommand as RuntimeRow
    : {}
  const command = normalizeCommand(rawEnvelope.command)
  const commandSha256 = await hashServiceCommandPayload(command)
  const envelope: ServiceCommandEnvelope = {
    operationId: text(rawEnvelope.operationId),
    targetApp: text(rawEnvelope.targetApp),
    operationCode: text(rawEnvelope.operationCode),
    requiredCapability: text(rawEnvelope.requiredCapability),
    idempotencyKey: text(rawEnvelope.idempotencyKey),
    commandSchemaVersion: text(rawEnvelope.commandSchemaVersion),
    commandSha256: text(rawEnvelope.commandSha256),
    command
  }
  const markdownContent = String(body.markdownContent || '')
  const actualMarkdownHash = createHash('sha256').update(markdownContent, 'utf8').digest('hex')
  const invalid = !envelope.operationId
    || envelope.targetApp !== 'codocs'
    || envelope.operationCode !== 'aims.company-weekly-summary.codocs-publish.v1'
    || envelope.requiredCapability !== 'codocs:company-weekly-summary:publish'
    || envelope.commandSchemaVersion !== 'v1'
    || envelope.commandSha256 !== commandSha256
    || envelope.idempotencyKey !== command.idempotencyKey
    || command.periodKey !== periodKey
    || !/^[0-9]{4}-W(?:0[1-9]|[1-4][0-9]|5[0-3])$/.test(command.periodKey)
    || !command.summaryId
    || !command.summaryVersionId
    || !command.revisionNo
    || !command.title
    || command.documentType !== 'company'
    || !command.operatorUid
    || !/^[a-f0-9]{64}$/.test(command.markdownSha256)
    || actualMarkdownHash !== command.markdownSha256
  if (invalid) {
    throw createError({ statusCode: 403, message: 'Aims company weekly summary command is invalid.' })
  }

  const requestId = text(getHeader(event, 'x-request-id'))
  await verifyServiceCommandRuntimeHeaders({
    token: bearerToken(event),
    method: 'POST',
    requestTarget: getRequestURL(event).pathname,
    requestId,
    tenantCode: binding.tenant,
    sourceDeploymentCode: binding.sourceDeployment,
    targetDeploymentCode: binding.targetDeployment,
    sourceApp: 'aims',
    sourceClientId: 'aims.runtime',
    targetApp: 'codocs',
    envelope,
    readHeader: name => getHeader(event, name)
  })

  const ossPath = `codocs/publish/company/${periodKey}/company-weekly-summary.md`
  const uploaded = await uploadDocument(ossPath, markdownContent, 'company')
  const ossVersionId = text(uploaded.versionId) || `sha256-${command.markdownSha256}`
  const receipt = await callCodocsTenantRuntime<RuntimeRow>(
    event,
    `/v1/codocs/service/company-weekly-summaries/${encodeURIComponent(periodKey)}:publish`,
    {
      method: 'POST',
      scope: 'codocs.write',
      serviceTokenSourceBinding: 'service-client-policy',
      serviceCommandActor: { uid: command.operatorUid },
      body: {
        serviceCommand: envelope,
        markdownContent,
        ossPath,
        ossVersionId,
        documentUrl: text(uploaded.url)
      }
    }
  )
  const result = receipt.result && typeof receipt.result === 'object' && !Array.isArray(receipt.result)
    ? receipt.result as RuntimeRow
    : {}
  return { ...receipt, ...result }
}
