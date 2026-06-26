import type { RowDataPacket } from 'mysql2/promise'
import { getRequestURL } from 'h3'
import { normalizeNullableString, ok, requireString } from '~~/server/utils/api'
import { queryRows, queryRow } from '~~/server/utils/db'
import { buildAppEnvArtifact } from '~~/server/utils/licenseArtifacts'
import { CONSOLE_APP_CODE } from '~~/server/utils/consoleApp'
import { ensureConsoleVaultMasterKey } from '~~/server/utils/deploymentBootstrapSecrets'
import { normalizeDeploymentEnvironment } from '~~/server/utils/tenantDeploymentSettings'

interface ArtifactRow extends RowDataPacket {
  app_code: string
  app_name: string
  service_role: string
  deployment_id: number | null
  deployment_code: string | null
  deployment_name: string | null
  environment: string | null
  public_url: string | null
  base_path: string | null
  runtime_token_last4: string | null
  license_id: number | null
  license_code: string | null
  signed_token: string | null
}

interface CapabilityRow extends RowDataPacket {
  capability_code: string
  capability_value: string | null
}

function buildFilename(tenantCode: string, appCode: string, suffix: string) {
  return `${tenantCode}.${appCode}.${suffix}`
}

export default defineEventHandler(async (event) => {
  const appCode = requireString(getRouterParam(event, 'appCode'), 'appCode')
  const query = getQuery(event)
  const tenantCode = requireString(query.tenantCode, 'tenantCode')
  const environment = normalizeDeploymentEnvironment(query.environment)
  const platformBaseUrl = normalizeNullableString(query.platformBaseUrl)
    || String(useRuntimeConfig(event).public?.serviceUrl || '').trim()
    || getRequestURL(event).origin

  const row = await queryRow<ArtifactRow>(
    `SELECT pa.app_code, pa.app_name, pa.service_role,
            d.id AS deployment_id,
            d.deployment_code,
            d.deployment_name,
            d.environment,
            ds.public_url,
            d.base_path,
            trc.runtime_token_last4,
            l.id AS license_id,
            l.license_code,
            l.signed_token
     FROM platform_applications pa
     LEFT JOIN tenant_runtime_credentials trc
       ON trc.tenant_code = ?
     LEFT JOIN deployments d
       ON d.id = (
         SELECT d2.id
         FROM deployments d2
         WHERE d2.tenant_code = ?
           AND d2.app_code = pa.app_code
           AND d2.environment = ?
           AND d2.status = 'active'
         ORDER BY CASE WHEN d2.status = 'active' THEN 0 ELSE 1 END, d2.updated_at DESC, d2.id DESC
         LIMIT 1
       )
     LEFT JOIN deployment_sites ds
       ON ds.id = d.site_id
      AND ds.status = 'active'
     LEFT JOIN license_deployments ld
       ON ld.id = (
         SELECT ld2.id
         FROM license_deployments ld2
         WHERE ld2.deployment_id = d.id
         ORDER BY CASE WHEN ld2.status = 'active' THEN 0 ELSE 1 END, ld2.effective_from DESC, ld2.id DESC
         LIMIT 1
       )
     LEFT JOIN licenses l ON l.id = ld.license_id
     WHERE pa.app_code = ?
     LIMIT 1`,
    [tenantCode, tenantCode, environment, appCode]
  )

  if (!row) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      message: `application not found: appCode=${appCode}`
    })
  }

  const warnings: string[] = []
  let envArtifact: null | { filename: string, content: string } = null
  const licenseArtifact: null | { filename: string, content: string } = null

  if (row.service_role === 'supporting_service' && row.deployment_id && row.deployment_code) {
    const consoleVaultMasterKey = appCode === CONSOLE_APP_CODE
      ? await ensureConsoleVaultMasterKey({
          deploymentId: row.deployment_id,
          tenantCode,
          appCode
        })
      : null
    envArtifact = {
      filename: buildFilename(tenantCode, appCode, 'env'),
      content: await buildAppEnvArtifact({
        tenantCode,
        appCode,
        deploymentCode: row.deployment_code,
        environment,
        licenseToken: appCode === CONSOLE_APP_CODE ? row.signed_token : null,
        platformBaseUrl,
        deploymentPublicUrl: row.public_url,
        appBasePath: row.base_path,
        consoleVaultMasterKey
      })
    }
    if (row.runtime_token_last4) {
      warnings.push(`Platform only stores the tenant Runtime Token hash. Current token last4=${row.runtime_token_last4}; rotate the token to display plaintext again.`)
    } else {
      warnings.push('Tenant Runtime Token has not been issued yet. Rotate it before using this env.')
    }
  } else if (row.service_role !== 'supporting_service') {
    warnings.push('业务应用不再由 Platform 下发 .env 或 license.lic；请使用 Console runtime/app identity 获取运行时配置与服务令牌。')
  } else {
    warnings.push('当前应用尚未创建 deployment，暂不能生成 env。')
  }

  if (row.license_id && !row.signed_token) {
    warnings.push('当前 license 缺少 signed_token，请重新保存一次开通编排以重新签发 license。')
  } else if (!row.license_id) {
    warnings.push('当前应用尚未签发 license。')
  }

  const capabilities = row.license_id
    ? await queryRows<CapabilityRow[]>(
        `SELECT capability_code, capability_value
         FROM license_capabilities
         WHERE license_id = ?
         ORDER BY capability_code ASC`,
        [row.license_id]
      )
    : []

  return ok({
    tenantCode,
    environment,
    appCode,
    appName: row.app_name,
    deployment: row.deployment_id
      ? {
          id: row.deployment_id,
          deploymentCode: row.deployment_code,
          deploymentName: row.deployment_name,
          environment: row.environment
        }
      : null,
    license: row.license_id
      ? {
          id: row.license_id,
          licenseCode: row.license_code,
          capabilities: capabilities.map(item => ({
            capabilityCode: item.capability_code,
            capabilityValue: item.capability_value
          }))
        }
      : null,
    artifacts: {
      env: envArtifact,
      license: licenseArtifact
    },
    warnings
  })
})
