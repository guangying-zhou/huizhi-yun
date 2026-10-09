import { reviewEnvironmentPolicy } from './environmentPolicyReview.ts'
import { createError } from 'h3'
import { queryRow, queryRows } from './db'
import { buildPolicyBundlePayload, redactPolicyBundlePayloadForResponse } from './policyBundle'
import { loadEnvironmentAppSelection, loadEnvironmentAppReleaseState, pinsFromBundle, selectionReceipt, loadPinSourceBundle } from './environmentAppReleases.ts'
import { parseAppPins, pinEnvironment, pinHash, diffEnvironmentPolicy, type Fact } from './environmentAppReleaseModel.ts'

export async function previewEnvironmentAppReleases(tenant: string, body: Fact) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw createError({ statusCode: 400, message: '请求必须为 JSON 对象' })
  if (body.sourceBundleId !== undefined && (!Number.isSafeInteger(body.sourceBundleId) || body.sourceBundleId <= 0)) throw createError({ statusCode: 400, message: '基线包编号无效' })
  const environment = pinEnvironment(body.environment)
  if (Object.keys(body).some(k => !['environment', 'pins', 'sourceBundleId', 'expectedRevision', 'reviewHash', 'reason'].includes(k))) throw createError({ statusCode: 400, message: '请求含未知字段' })
  const q = { queryRow, queryRows }
  const current = await loadEnvironmentAppReleaseState(q, tenant, environment)
  if (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision !== (current?.revision || 0)) throw createError({ statusCode: 409, message: '选择版本冲突，请刷新' })
  const bundleId = current?.sourceBundleId || Number(body.sourceBundleId) || null
  if (current && body.sourceBundleId && Number(body.sourceBundleId) !== current.sourceBundleId) throw createError({ statusCode: 409, message: '初始化来源不能被替换' })
  if (bundleId !== null && (!Number.isSafeInteger(bundleId) || bundleId <= 0)) throw createError({ statusCode: 400, message: '基线包编号无效' })
  const latest = await queryRow('SELECT MAX(id) AS id FROM policy_bundles WHERE tenant_code=? AND environment=?', [tenant, environment])
  if (!current && environment === 'prod' && latest?.id && !bundleId) throw createError({ statusCode: 409, message: 'prod 必须从已签基线包初始化' })
  const initialized = !current && bundleId ? await pinsFromBundle(q, tenant, environment, bundleId) : null
  const pins = body.pins ? parseAppPins(body.pins) : initialized?.pins || current?.pins
  if (!pins) throw createError({ statusCode: 400, message: '请选择应用版本或已签基线包' })
  // Initialization is exactly the historical set; an upgrade is a separate reviewed save.
  if (initialized && pinHash(pins) !== pinHash(initialized.pins)) throw createError({ statusCode: 409, message: '首次初始化必须精确保留基线全部 release，之后再单独升级应用' })
  const selection = (await loadEnvironmentAppSelection(q, tenant, environment, { pins, sourceBundleId: bundleId }))!
  const candidate = await buildPolicyBundlePayload({ tenantCode: tenant, environment, appSelection: selection })

  const baseline = latest?.id ? await loadPinSourceBundle(q, tenant, environment, Number(latest.id)) : null
  const before = initialized?.source.payload || baseline?.payload || {}
  const diff = diffEnvironmentPolicy(redactPolicyBundlePayloadForResponse(before), redactPolicyBundlePayloadForResponse(candidate))
  const review = reviewEnvironmentPolicy(redactPolicyBundlePayloadForResponse(before), redactPolicyBundlePayloadForResponse(candidate))
  const sensitiveConfigurationChanged = pinHash(before.consoleLogin) !== pinHash(candidate.consoleLogin)
  // All policy facts, not just the selection, bind review. No receipt, revision or signature writes.
  const reviewHash = pinHash({ tenant, environment, expectedRevision: body.expectedRevision, selection: selectionReceipt(selection), diff, review, sensitiveConfigurationChanged, policyFactsHash: pinHash({ ...candidate, generatedAt: null, policyRevision: 0 }) })
  return { selection, environment, candidate, result: { expectedRevision: body.expectedRevision, selection: selectionReceipt(selection), sensitiveConfigurationChanged, comparedBundleId: initialized?.source.id || baseline?.id || null, diff, review, reviewHash } }
}
