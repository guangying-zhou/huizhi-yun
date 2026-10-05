#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import process from 'node:process'

const CHECKS = [
  {
    file: 'platform/server/api/platform/tenant-admin/deployment-settings.get.ts',
    description: 'tenant deployment settings token summary',
    required: [
      'FROM deployment_bootstrap_secrets s',
      'INNER JOIN deployments d ON d.id = s.deployment_id',
      'AND d.environment = ?'
    ]
  },
  {
    file: 'platform/server/api/platform/internal/tenant-gateway/resolve.get.ts',
    description: 'tenant gateway static token resolution',
    required: [
      'FROM deployment_bootstrap_secrets s',
      'INNER JOIN deployments d ON d.id = s.deployment_id',
      'AND d.environment = ?',
      'loadDataRuntimeStaticToken(site.tenant_code, site.environment)'
    ]
  },
  {
    file: 'platform/server/api/platform/tenant-admin/deployment-settings/install-command.post.ts',
    description: 'tenant install command token lookup',
    required: [
      'FROM deployment_bootstrap_secrets s',
      'INNER JOIN deployments d ON d.id = s.deployment_id',
      'AND d.environment = ?'
    ]
  },
  {
    file: 'platform/app/pages/dashboard/deployments.vue',
    description: 'tenant deployment dashboard default environment',
    required: [
      'const runtimeConfig = useRuntimeConfig()',
      'runtimeConfig.public.platformStage',
      'const selectedEnvironment = ref(defaultDeploymentEnvironment())',
      "'/api/platform/tenant-admin/bundles'",
      'query: { tenantCode: tenantCode.value, environment: selectedEnvironment.value }',
      'environment: selectedEnvironment.value'
    ],
    forbidden: [
      "const selectedEnvironment = ref('prod')"
    ]
  },
  {
    file: 'platform/server/api/platform/tenant-admin/bundles.post.ts',
    description: 'tenant policy bundle generation endpoint environment scoping',
    required: [
      "import { normalizeDeploymentEnvironment } from '~~/server/utils/tenantDeploymentSettings'",
      'const environment = normalizeDeploymentEnvironment(body?.environment || getQuery(event).environment)',
      'environment,',
      'environment: generated.environment'
    ]
  },
  {
    file: 'platform/server/api/platform/_handlers/ops/tenants/[tenantCode]/bundles.post.ts',
    description: 'ops policy bundle generation endpoint environment scoping',
    required: [
      "import { normalizeDeploymentEnvironment } from '~~/server/utils/tenantDeploymentSettings'",
      'const environment = normalizeDeploymentEnvironment(body?.environment || getQuery(event).environment)',
      'environment,',
      'environment: generated.environment'
    ]
  },
  {
    file: 'platform/server/utils/policyBundle.ts',
    description: 'policy bundle generation SQL environment scoping',
    required: [
      'const environment = normalizeDeploymentEnvironment(input.environment)',
      'await buildPolicyBundlePayload({ tenantCode, environment, platformBaseUrl })',
      'const consoleLogin = consoleLoginSettings(tenantSettings, environment)',
      'consoleLogin,',
      'WHERE tenant_code = ?\n         AND environment = ?',
      'const bundleVersion = `pv_${environment}_',
      'const bundleUri = `inline://policy-bundles/${tenantCode}/${environment}/${bundleVersion}`',
      '(tenant_code, environment, bundle_version, bundle_hash, bundle_payload_json, bundle_uri,',
      "FROM deployments\n       WHERE tenant_code = ?\n         AND environment = ?\n         AND status = 'active'"
    ]
  }
]

function usage() {
  return `
Usage:
  pnpm run validate:platform-env-isolation

Checks Platform tenant runtime bootstrap-token paths that are easy to make
tenant-only by mistake. These paths must resolve deployment_bootstrap_secrets
through deployments.environment so prod/test tenant environments do not expose
or display each other's Data Runtime static token.
`
}

function fail(message) {
  console.error(`[platform-env-isolation] ${message}`)
  process.exit(1)
}

function assertCheck(check) {
  if (!existsSync(check.file)) {
    fail(`${check.file} is missing`)
  }

  const content = readFileSync(check.file, 'utf8')
  for (const required of check.required) {
    if (!content.includes(required)) {
      fail(`${check.description} in ${check.file} must include ${required}`)
    }
  }

  for (const forbidden of check.forbidden || []) {
    if (content.includes(forbidden)) {
      fail(`${check.description} in ${check.file} must not hard-code ${forbidden}`)
    }
  }

  console.info(`[platform-env-isolation] ${check.description} passed`)
}

function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.info(usage().trim())
    return
  }

  for (const check of CHECKS) {
    assertCheck(check)
  }

  console.info('[platform-env-isolation] passed')
}

try {
  main()
} catch (error) {
  console.error(`[platform-env-isolation] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
