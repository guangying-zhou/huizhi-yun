#!/usr/bin/env node

import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  verifyCutoverGateObservation,
  verifyCurrentWorkerDeployment,
  verifyProductionConnectorObservation,
  verifyRuntimeHostObservation
} from './lib/console-zero-db-observation.mjs'

const root = resolve(import.meta.dirname, '..')
const argv = process.argv.slice(2)

function usage() {
  return `
Usage:
  pnpm run observe:console-zero-db-cutover -- \\
    --console-url https://wiztek.huizhi.yun/ \\
    --runtime-url https://wiztek-data-runtime.huizhi.yun \\
    --platform-url https://huizhi.yun \\
    --platform-internal-token-file /secure/hzy-cloudflare-internal.token \\
    --tenant-code C000001 \\
    --environment prod \\
    --ssh-host root@dev.quantics.ca \\
    --connector-ssh-host root@8.130.81.31 \\
    --expected-connector-id connector-runtime.C000001-console \\
    --expected-connector-version 0.4.22 \\
    --max-connector-heartbeat-age-seconds 120 \\
    --worker-version-id <version-id> \\
    --worker-version-number <number> \\
    --expected-worker-binding-count <count> \\
    --expected-runtime-version <version> \\
    --expected-schema-revision sha256:<digest> \\
    --observation-start <ISO-8601> \\
    --not-before-close <ISO-8601> \\
    --evidence-file /secure/path/observation.json

Runs the zero-DB verifier, proves the expected Cloudflare Worker is the sole
100% deployment, and checks Runtime/Updater/Connector systemd state plus Console
database grants and Connector heartbeat over SSH. It obtains a short-lived
schema token through the Platform bootstrap trust chain. Supplying
--schema-token-env remains supported for an already-issued token. Secrets are
never written to evidence.
`
}

function option(name, { required = false, fallback = '' } = {}) {
  const index = argv.findIndex(item => item === name || item.startsWith(`${name}=`))
  let value = fallback
  if (index >= 0) {
    const item = argv[index]
    value = item.includes('=') ? item.slice(item.indexOf('=') + 1) : String(argv[index + 1] || '')
  }
  value = String(value || '').trim()
  if (required && !value) throw new Error(`missing required option ${name}`)
  return value
}

function positiveInteger(name, { required = false, fallback = '' } = {}) {
  const raw = option(name, { required, fallback })
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
  return value
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    ...options
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim()
    throw new Error(`${options.label || command} failed${detail ? `: ${detail}` : ''}`)
  }
  return String(result.stdout || '')
}

function parseISO(name, value) {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) throw new Error(`${name} must be a valid ISO-8601 timestamp`)
  return timestamp
}

async function fetchJSON(url, init, label) {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(10_000)
  })
  if (!response.ok) {
    throw new Error(`${label} failed: HTTP ${response.status}`)
  }
  return response.json()
}

async function issueSchemaToken({
  platformUrl,
  platformInternalTokenFile,
  runtimeUrl,
  consoleUrl,
  tenantCode,
  environment
}) {
  const tokenPath = resolve(process.cwd(), platformInternalTokenFile)
  const tokenStat = statSync(tokenPath)
  if (!tokenStat.isFile() || (tokenStat.mode & 0o077) !== 0) {
    throw new Error('Platform internal token file must be a regular file with no group/other permissions')
  }
  const internalToken = readFileSync(tokenPath, 'utf8').trim()
  if (!internalToken) throw new Error('Platform internal token file is empty')

  const bootstrap = await fetchJSON(
    `${platformUrl.replace(/\/+$/, '')}/api/platform/internal/tenant-gateway/runtime-bootstrap-token`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${internalToken}`,
        'Content-Type': 'application/json',
        'x-hzy-internal-principal': 'console-cutover-observer'
      },
      body: JSON.stringify({ tenantCode, environment, appCode: 'console' })
    },
    'Platform Runtime bootstrap token issuance'
  )
  const bootstrapToken = String(bootstrap?.data?.token || '').trim()
  if (!bootstrapToken) throw new Error('Platform Runtime bootstrap response did not include a token')

  const requestId = `console-cutover-observer-${Date.now()}`
  const issued = await fetchJSON(
    `${runtimeUrl.replace(/\/+$/, '')}/v1/console/auth/service-tokens/issue`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${bootstrapToken}`,
        'Content-Type': 'application/json',
        'x-request-id': requestId
      },
      body: JSON.stringify({
        audience: 'data-runtime',
        scope: 'console.schema.read',
        ttlSeconds: 300,
        issuer: new URL(consoleUrl).origin,
        sourceBinding: 'trusted-gateway'
      })
    },
    'Console schema-read token issuance'
  )
  const schemaToken = String(issued?.data?.accessToken || '').trim()
  if (!schemaToken || issued?.data?.scope !== 'console.schema.read') {
    throw new Error('Runtime did not issue the exact console.schema.read scope')
  }
  return schemaToken
}

function verifyWorker(versionId, expectedNumber, expectedBindingCount) {
  const deploymentRaw = run(
    'pnpm',
    [
      'dlx',
      'wrangler@4',
      'deployments',
      'status',
      '--config',
      'console/.wrangler.generated.jsonc',
      '--json'
    ],
    { label: 'Cloudflare Worker deployment inspection' }
  )
  const deployment = verifyCurrentWorkerDeployment(JSON.parse(deploymentRaw), versionId)
  const raw = run(
    'pnpm',
    [
      'dlx',
      'wrangler@4',
      'versions',
      'view',
      versionId,
      '--config',
      'console/.wrangler.generated.jsonc',
      '--json'
    ],
    { label: 'Cloudflare Worker version inspection' }
  )
  const payload = JSON.parse(raw)
  const bindings = Array.isArray(payload?.resources?.bindings) ? payload.resources.bindings : []
  const forbiddenNames = new Set([
    'HZY_CONSOLE_HYPERDRIVE_ID',
    'HZY_CONSOLE_VAULT_MASTER_KEY',
    'CONSOLE_VAULT_MASTER_KEY',
    'CONSOLE_AUTH_SIGNING_PRIVATE_JWK',
    'CONSOLE_AUTH_SIGNING_KEY_AUTOGENERATE',
    'CONSOLE_AUTH_SIGNING_KEY_ROTATE_UNUSABLE',
    'DB_HOST',
    'DB_PORT',
    'DB_USER',
    'DB_PASSWORD',
    'DB_NAME',
    'DB_CONNECTION_LIMIT'
  ])
  const forbidden = bindings
    .filter(binding => {
      const name = String(binding?.name || '')
      const type = String(binding?.type || '').toLowerCase()
      return forbiddenNames.has(name) ||
        /^HZY_CONSOLE_DB_/.test(name) ||
        type.includes('hyperdrive') ||
        type === 'd1' ||
        type === 'd1_database'
    })
    .map(binding => ({
      name: String(binding?.name || ''),
      type: String(binding?.type || '')
    }))

  if (payload.id !== versionId) throw new Error(`Worker version mismatch: ${String(payload.id || 'unknown')}`)
  if (Number(payload.number) !== expectedNumber) {
    throw new Error(`Worker version number mismatch: expected ${expectedNumber}, got ${String(payload.number)}`)
  }
  if (bindings.length !== expectedBindingCount) {
    throw new Error(`Worker binding count mismatch: expected ${expectedBindingCount}, got ${bindings.length}`)
  }
  if (forbidden.length > 0) {
    throw new Error(`Worker contains forbidden tenant-data bindings: ${forbidden.map(item => `${item.name}:${item.type}`).join(', ')}`)
  }

  return {
    script: 'hzy-console-prod',
    versionId,
    versionNumber: Number(payload.number),
    bindingCount: bindings.length,
    forbiddenBindings: forbidden,
    ...deployment
  }
}

function verifyRemote({
  host,
  observationStart,
  observationStartMs,
  expectedRuntimeVersion,
  expectedConnectorId,
  expectedConnectorVersion,
  maxConnectorHeartbeatAgeSeconds
}) {
  const mysqlArguments = '${mysql_args[@]}'
  const connectorIdHex = Buffer.from(expectedConnectorId, 'utf8').toString('hex').toUpperCase()
  const remoteScript = String.raw`
set -euo pipefail
observation_start="$1"
connector_id_hex="$2"
observation_since="$(date -u -d "$observation_start" '+%Y-%m-%d %H:%M:%S UTC')"
source /etc/hzy-data-runtime/.env
export MYSQL_PWD="$HZY_DATA_RUNTIME_DB_PASSWORD"
mysql_args=(-N -B -h "$HZY_DATA_RUNTIME_DB_HOST" -P "$HZY_DATA_RUNTIME_DB_PORT" -u "$HZY_DATA_RUNTIME_DB_USER" "$HZY_CONSOLE_DB_NAME")
service_enabled="$(systemctl is-enabled hzy-data-runtime)"
service_state="$(systemctl is-active hzy-data-runtime)"
restart_count="$(systemctl show hzy-data-runtime -p NRestarts --value)"
boot_epoch="$(awk '$1=="btime" { print $2 }' /proc/stat)"
active_since_monotonic="$(systemctl show hzy-data-runtime -p ActiveEnterTimestampMonotonic --value)"
active_since_epoch="$((boot_epoch + active_since_monotonic / 1000000))"
active_since="$(date -u -d "@$active_since_epoch" '+%Y-%m-%dT%H:%M:%S.000Z')"
warning_count="$(journalctl -u hzy-data-runtime --since "$observation_since" -p warning --no-pager -q | wc -l | tr -d ' ')"
update_timer_enabled="$(systemctl is-enabled hzy-data-runtime-update.timer)"
update_timer_state="$(systemctl is-active hzy-data-runtime-update.timer)"
update_request_path_enabled="$(systemctl is-enabled hzy-data-runtime-update-request.path)"
update_request_path_state="$(systemctl is-active hzy-data-runtime-update-request.path)"
update_service_failed="$(systemctl is-failed hzy-data-runtime-update.service 2>/dev/null || true)"
update_request_service_failed="$(systemctl is-failed hzy-data-runtime-update-request.service 2>/dev/null || true)"
updater_target_version="$(systemctl cat hzy-data-runtime-update.service --no-pager | sed -nE 's/.*--version[[:space:]]+([^[:space:]]+).*/\1/p' | head -n 1)"
duplicate_connector_enabled="$(systemctl is-enabled hzy-connector-runtime.service 2>/dev/null || true)"
duplicate_connector_state="$(systemctl is-active hzy-connector-runtime.service 2>/dev/null || true)"
legacy_count="$(mysql "${mysqlArguments}" -e "SELECT COUNT(*) FROM information_schema.schema_privileges WHERE table_schema=0x687a795f636f6e736f6c65 AND grantee=0x2763665f6170702740272527;")"
runtime_count="$(mysql "${mysqlArguments}" -e "SELECT COUNT(*) FROM information_schema.schema_privileges WHERE table_schema=0x687a795f636f6e736f6c65 AND grantee=0x27687a795f636f6e736f6c655f72756e74696d652740276c6f63616c686f737427;")"
platform_count="$(mysql "${mysqlArguments}" -e "SELECT COUNT(*) FROM information_schema.schema_privileges WHERE table_schema=0x687a795f636f6e736f6c65 AND grantee=0x27687a795f706c6174666f726d5f63662740272527;")"
connector_id="$(mysql "${mysqlArguments}" -e "SELECT connector_id FROM connector_runtime_instances WHERE HEX(connector_id)='$connector_id_hex' LIMIT 1;")"
connector_status="$(mysql "${mysqlArguments}" -e "SELECT status FROM connector_runtime_instances WHERE HEX(connector_id)='$connector_id_hex' LIMIT 1;")"
connector_version="$(mysql "${mysqlArguments}" -e "SELECT agent_version FROM connector_runtime_instances WHERE HEX(connector_id)='$connector_id_hex' LIMIT 1;")"
connector_last_heartbeat_at="$(mysql "${mysqlArguments}" -e "SELECT DATE_FORMAT(last_heartbeat_at,'%Y-%m-%dT%H:%i:%s.%fZ') FROM connector_runtime_instances WHERE HEX(connector_id)='$connector_id_hex' LIMIT 1;")"
connector_heartbeat_age="$(mysql "${mysqlArguments}" -e "SELECT TIMESTAMPDIFF(SECOND,last_heartbeat_at,UTC_TIMESTAMP()) FROM connector_runtime_instances WHERE HEX(connector_id)='$connector_id_hex' LIMIT 1;")"
if [[ -z "$connector_heartbeat_age" ]]; then connector_heartbeat_age=-1; fi
printf '{"serviceEnabled":"%s","serviceState":"%s","activeSince":"%s","restartCount":%s,"warningsSinceObservationStart":%s,"updateTimerEnabled":"%s","updateTimerState":"%s","updateRequestPathEnabled":"%s","updateRequestPathState":"%s","updateServiceFailed":"%s","updateRequestServiceFailed":"%s","updaterTargetVersion":"%s","legacyConsolePrivilegeCount":%s,"runtimeConsolePrivilegeCount":%s,"platformConsolePrivilegeCount":%s,"duplicateConnectorEnabled":"%s","duplicateConnectorState":"%s","connectorId":"%s","connectorStatus":"%s","connectorVersion":"%s","connectorLastHeartbeatAt":"%s","connectorHeartbeatAgeSeconds":%s}\n' \
  "$service_enabled" "$service_state" "$active_since" "$restart_count" "$warning_count" \
  "$update_timer_enabled" "$update_timer_state" "$update_request_path_enabled" "$update_request_path_state" \
  "$update_service_failed" "$update_request_service_failed" "$updater_target_version" \
  "$legacy_count" "$runtime_count" "$platform_count" \
  "$duplicate_connector_enabled" "$duplicate_connector_state" \
  "$connector_id" "$connector_status" "$connector_version" "$connector_last_heartbeat_at" "$connector_heartbeat_age"
`
  const raw = run(
    'ssh',
    ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', host, 'bash', '-s', '--', observationStart, connectorIdHex],
    { input: remoteScript, label: 'Runtime host observation' }
  )
  const payload = JSON.parse(raw.trim())
  return verifyRuntimeHostObservation(payload, {
    observationStartMs,
    expectedRuntimeVersion,
    expectedConnectorId,
    expectedConnectorVersion,
    maxConnectorHeartbeatAgeSeconds
  })
}

function verifyConnector({
  host,
  observationStartMs,
  expectedVersion
}) {
  const remoteScript = String.raw`
set -euo pipefail
service_enabled="$(systemctl is-enabled hzy-connector-runtime.service)"
service_state="$(systemctl is-active hzy-connector-runtime.service)"
restart_count="$(systemctl show hzy-connector-runtime.service -p NRestarts --value)"
boot_epoch="$(awk '$1=="btime" { print $2 }' /proc/stat)"
active_since_monotonic="$(systemctl show hzy-connector-runtime.service -p ActiveEnterTimestampMonotonic --value)"
active_since_epoch="$((boot_epoch + active_since_monotonic / 1000000))"
active_since="$(date -u -d "@$active_since_epoch" '+%Y-%m-%dT%H:%M:%S.000Z')"
version="$(/usr/local/bin/hzy-connector-runtime -version)"
printf '{"serviceEnabled":"%s","serviceState":"%s","activeSince":"%s","restartCount":%s,"version":"%s"}\n' \
  "$service_enabled" "$service_state" "$active_since" "$restart_count" "$version"
`
  const raw = run(
    'ssh',
    ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', host, 'bash', '-s'],
    { input: remoteScript, label: 'Production Connector Runtime observation' }
  )
  return verifyProductionConnectorObservation(JSON.parse(raw.trim()), {
    observationStartMs,
    expectedVersion
  })
}

function verifyCutover({
  consoleUrl,
  runtimeUrl,
  schemaToken,
  expectedRuntimeVersion,
  expectedSchemaRevision
}) {
  const temporaryDirectory = mkdtempSync(resolve(tmpdir(), 'hzy-console-observation-'))
  const temporaryEvidence = resolve(temporaryDirectory, 'zero-db.json')
  const schemaTokenEnv = 'HZY_CONSOLE_OBSERVATION_SCHEMA_TOKEN'
  try {
    run(
      process.execPath,
      [
        'scripts/verify-console-zero-db-cutover.mjs',
        '--console-url',
        consoleUrl,
        '--runtime-url',
        runtimeUrl,
        '--schema-token-env',
        schemaTokenEnv,
        '--evidence-file',
        temporaryEvidence
      ],
      {
        env: {
          ...process.env,
          [schemaTokenEnv]: schemaToken
        },
        label: 'Console zero-DB cutover verifier'
      }
    )
    const evidence = JSON.parse(readFileSync(temporaryEvidence, 'utf8'))
    const health = evidence?.runtime?.health
    const cutover = evidence?.runtime?.cutover
    if (health?.version !== expectedRuntimeVersion) {
      throw new Error(`Runtime version mismatch: expected ${expectedRuntimeVersion}, got ${String(health?.version || 'unknown')}`)
    }
    if (cutover?.schemaRevision !== expectedSchemaRevision) {
      throw new Error(`schema revision mismatch: expected ${expectedSchemaRevision}, got ${String(cutover?.schemaRevision || 'unknown')}`)
    }
    verifyCutoverGateObservation(cutover)
    return {
      console: evidence.console,
      runtime: {
        url: evidence.runtime.url,
        health: {
          status: health.status,
          runtimeProduct: health.runtimeProduct,
          version: health.version,
          builtAt: health.builtAt,
          commit: health.commit,
          tenant: health.tenant,
          deployment: health.deployment,
          consoleAdapter: health.apps?.console
        },
        cutover: {
          status: cutover.status,
          checkedAt: cutover.checkedAt,
          schemaRevision: cutover.schemaRevision,
          blockers: cutover.blockers,
          checks: cutover.checks,
          metrics: cutover.metrics
        }
      }
    }
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true })
  }
}

function writeEvidence(path, payload) {
  const output = resolve(process.cwd(), path)
  mkdirSync(dirname(output), { recursive: true })
  writeFileSync(output, `${JSON.stringify(payload, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600
  })
  chmodSync(output, 0o600)
  return output
}

if (argv.includes('--help') || argv.includes('-h')) {
  console.info(usage().trim())
  process.exit(0)
}

try {
  const consoleUrl = option('--console-url', { required: true })
  const runtimeUrl = option('--runtime-url', { required: true })
  const schemaTokenEnv = option('--schema-token-env')
  const platformUrl = option('--platform-url', { fallback: 'https://huizhi.yun' })
  const platformInternalTokenFile = option('--platform-internal-token-file')
  const tenantCode = option('--tenant-code', { fallback: 'C000001' })
  const environment = option('--environment', { fallback: 'prod' })
  let schemaToken = schemaTokenEnv ? String(process.env[schemaTokenEnv] || '').trim() : ''
  let schemaTokenSource = 'environment'
  if (schemaTokenEnv && !schemaToken) {
    throw new Error(`schema token environment variable is empty: ${schemaTokenEnv}`)
  }
  if (!schemaToken) {
    if (!platformInternalTokenFile) {
      throw new Error('provide --schema-token-env or --platform-internal-token-file')
    }
    schemaTokenSource = 'platform_bootstrap'
    schemaToken = await issueSchemaToken({
      platformUrl,
      platformInternalTokenFile,
      runtimeUrl,
      consoleUrl,
      tenantCode,
      environment
    })
  }
  const sshHost = option('--ssh-host', { required: true })
  const connectorSshHost = option('--connector-ssh-host', { required: true })
  const expectedConnectorId = option('--expected-connector-id', { required: true })
  const expectedConnectorVersion = option('--expected-connector-version', { required: true })
  const maxConnectorHeartbeatAgeSeconds = positiveInteger('--max-connector-heartbeat-age-seconds', {
    fallback: '120'
  })
  const workerVersionId = option('--worker-version-id', { required: true })
  const workerVersionNumber = positiveInteger('--worker-version-number', { required: true })
  const expectedWorkerBindingCount = positiveInteger('--expected-worker-binding-count', { required: true })
  const expectedRuntimeVersion = option('--expected-runtime-version', { required: true })
  const expectedSchemaRevision = option('--expected-schema-revision', { required: true })
  const observationStart = option('--observation-start', { required: true })
  const notBeforeClose = option('--not-before-close', { required: true })
  const evidenceFile = option('--evidence-file', { required: true })
  const observationStartMs = parseISO('--observation-start', observationStart)
  const notBeforeCloseMs = parseISO('--not-before-close', notBeforeClose)
  if (notBeforeCloseMs - observationStartMs < 72 * 60 * 60 * 1000) {
    throw new Error('observation window must be at least 72 hours')
  }

  console.info('[console-zero-db-observation] checking Cloudflare Worker version')
  const worker = verifyWorker(workerVersionId, workerVersionNumber, expectedWorkerBindingCount)
  console.info('[console-zero-db-observation] checking Runtime host, updater, database ACL, and Connector heartbeat')
  const host = verifyRemote({
    host: sshHost,
    observationStart,
    observationStartMs,
    expectedRuntimeVersion,
    expectedConnectorId,
    expectedConnectorVersion,
    maxConnectorHeartbeatAgeSeconds
  })
  console.info('[console-zero-db-observation] checking unique production Connector Runtime')
  const connector = verifyConnector({
    host: connectorSshHost,
    observationStartMs,
    expectedVersion: expectedConnectorVersion
  })
  console.info('[console-zero-db-observation] checking Console and Runtime cutover gate')
  const cutover = verifyCutover({
    consoleUrl,
    runtimeUrl,
    schemaToken,
    expectedRuntimeVersion,
    expectedSchemaRevision
  })
  const observedAt = new Date()
  const eligibleToClose = observedAt.getTime() >= notBeforeCloseMs
  const output = writeEvidence(evidenceFile, {
    schemaVersion: 1,
    evidenceType: 'console-zero-db-observation',
    observedAt: observedAt.toISOString(),
    observationWindow: {
      startedAt: new Date(observationStartMs).toISOString(),
      notBeforeCloseAt: new Date(notBeforeCloseMs).toISOString(),
      requiredHours: 72,
      status: eligibleToClose ? 'eligible_for_close_review' : 'in_progress'
    },
    verdict: {
      checksPassed: true,
      eligibleToClose
    },
    authentication: {
      schemaTokenSource,
      schemaTokenStored: false
    },
    ...cutover,
    worker,
    host,
    connector,
    secretsIncluded: false
  })
  console.info(`[console-zero-db-observation] passed evidence=${output} eligibleToClose=${eligibleToClose}`)
} catch (error) {
  console.error(`[console-zero-db-observation] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
