#!/usr/bin/env node

import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto'
import { chmod, readFile, writeFile } from 'node:fs/promises'
import process from 'node:process'

const consoleBaseURL = 'https://hzy-test.wiztek.cn/console'
const runtimeDeployment = 'c000001-ctr812-test-runtime'
const expectedTenant = 'C000001'
const expectedConsoleDeployment = 'wiztek-test-console'
const consoleEnvFile = '/wiztek/huizhi-yun/ctr812-console-release/console/.env.test'
const sessionFile = '/etc/hzy-console-test/ctr812-session.json'
const evidenceFile = '/etc/hzy-console-test/evidence-ctr812-write-chain.json'

const profileFields = [
  'orgName',
  'orgShortName',
  'displayName',
  'legalName',
  'unifiedSocialCreditCode',
  'logoPath',
  'websiteUrl',
  'industryCode',
  'countryCode',
  'timezone',
  'locale',
  'currencyCode',
  'contactName',
  'contactEmail',
  'contactMobile',
  'addressText'
]

function unquote(value) {
  const trimmed = value.trim()
  if (
    trimmed.length >= 2
    && (
      (trimmed.startsWith('"') && trimmed.endsWith('"'))
      || (trimmed.startsWith("'") && trimmed.endsWith("'"))
    )
  ) {
    return trimmed.slice(1, -1)
      .replaceAll('\\n', '\n')
      .replaceAll('\\"', '"')
      .replaceAll('\\\\', '\\')
  }
  return trimmed
}

function parseEnv(content) {
  const env = new Map()
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim().replace(/^export\s+/, '')
    if (!line || line.startsWith('#')) continue
    const separator = line.indexOf('=')
    if (separator <= 0) continue
    env.set(line.slice(0, separator).trim(), unquote(line.slice(separator + 1)))
  }
  return env
}

function required(env, name) {
  const value = env.get(name)?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function fingerprint(value) {
  return `sha256:${sha256(String(value))}`
}

function stableJSON(value) {
  if (value === null || value === undefined) return 'null'
  if (Array.isArray(value)) return `[${value.map(stableJSON).join(',')}]`
  if (typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJSON(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function digestCommand(value) {
  return sha256(stableJSON(value))
}

function sleep(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

function dataOf(body) {
  return body?.data?.data || body?.data || body
}

function errorCode(body, status) {
  return String(
    body?.error?.code
    || body?.data?.error?.code
    || body?.code
    || `http_${status}`
  )
}

async function requestJSON(url, options = {}, expectedStatuses = [200]) {
  const response = await fetch(url, options)
  const body = await response.json().catch(() => null)
  if (!expectedStatuses.includes(response.status) || !body) {
    throw new Error(`${new URL(url).pathname}: ${errorCode(body, response.status)}`)
  }
  return { response, body, data: dataOf(body) }
}

function idempotency(label) {
  return `ctr812:${label}:${randomUUID()}`
}

function step(label, detail = {}) {
  console.info(JSON.stringify({ step: label, status: 'pass', ...detail }))
}

function requireCodeZero(result, label) {
  if (result.body?.code !== undefined && Number(result.body.code) !== 0) {
    throw new Error(`${label}: response code is not zero`)
  }
  return result
}

function profilePayload(profile, expectedRevision) {
  const result = { expectedRevision }
  for (const field of profileFields) {
    result[field] = profile[field] ?? null
  }
  return result
}

async function main() {
  if (!process.argv.includes('--execute')) {
    throw new Error('refusing without --execute')
  }

  const env = parseEnv(await readFile(consoleEnvFile, 'utf8'))
  const session = JSON.parse(await readFile(sessionFile, 'utf8'))
  const tenant = required(env, 'HZY_PLATFORM_TENANT_CODE')
  const consoleDeployment = required(env, 'HZY_PLATFORM_DEPLOYMENT_CODE')
  const runtimeURL = required(env, 'HZY_CONSOLE_TENANT_RUNTIME_URL').replace(/\/+$/, '')
  const runtimeToken = required(env, 'HZY_CONSOLE_TENANT_RUNTIME_TOKEN')
  if (
    tenant !== expectedTenant
    || consoleDeployment !== expectedConsoleDeployment
    || session.tenant !== expectedTenant
    || session.consoleDeployment !== expectedConsoleDeployment
    || session.runtimeDeployment !== runtimeDeployment
    || !runtimeURL.startsWith('http://127.0.0.1:18083')
  ) {
    throw new Error('refusing unexpected CTR-812 isolation binding')
  }
  if (!session.rawSessionId || !session.subjectUid || !session.storedSessionId) {
    throw new Error('CTR-812 administrator session is incomplete')
  }

  const cookie = `console_session=${session.rawSessionId}`
  const runtimeHeaders = {
    authorization: `Bearer ${runtimeToken}`,
    'x-hzy-tenant': tenant,
    'x-hzy-deployment': runtimeDeployment,
    accept: 'application/json'
  }
  const results = {}
  const runID = new Date().toISOString().replace(/\D/g, '').slice(0, 14).toLowerCase()

  async function bff(path, options = {}, expectedStatuses = [200]) {
    return await requestJSON(`${consoleBaseURL}${path}`, {
      ...options,
      headers: {
        cookie,
        accept: 'application/json',
        ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...options.headers
      }
    }, expectedStatuses)
  }

  async function runtime(path, options = {}, expectedStatuses = [200]) {
    return await requestJSON(`${runtimeURL}${path}`, {
      ...options,
      headers: {
        ...runtimeHeaders,
        ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...options.headers
      }
    }, expectedStatuses)
  }

  const health = await requestJSON(`${runtimeURL}/runtime/healthz`)
  if (
    health.body?.runtimeProduct !== 'hzy-data-runtime'
    || health.body?.tenant !== tenant
    || health.body?.deployment !== runtimeDeployment
    || health.body?.apps?.console?.db !== 'ok'
    || health.body?.apps?.directory?.db !== 'ok'
  ) {
    throw new Error('isolated Runtime health binding is invalid')
  }
  results.runtime = {
    version: health.body.version,
    commit: health.body.commit,
    console: health.body.apps.console.db,
    directory: health.body.apps.directory.db
  }
  step('runtime-health', { version: health.body.version })

  const authMe = requireCodeZero(await bff('/api/v1/console/auth/me'), 'auth-me')
  if (!authMe.data?.authenticated || authMe.data?.subject?.uid !== session.subjectUid) {
    throw new Error('Console BFF did not resolve the isolated administrator session')
  }
  const permissions = requireCodeZero(await bff('/api/auth/permissions'), 'permissions')
  const roleCodes = Array.isArray(permissions.data?.roleCodes)
    ? permissions.data.roleCodes
    : Array.isArray(permissions.data?.roles)
      ? permissions.data.roles.map(item => String(item?.roleCode || item || '').trim()).filter(Boolean)
      : []
  if (permissions.data?.authorizationMode !== 'merged' || !roleCodes.includes('system_admin')) {
    throw new Error('isolated administrator authorization is not merged system_admin')
  }
  results.consoleSession = {
    authenticated: true,
    authorizationMode: permissions.data.authorizationMode,
    systemAdmin: true,
    subjectFingerprint: fingerprint(session.subjectUid)
  }
  step('console-session-and-policy')

  const originalProfile = requireCodeZero(await bff('/api/v1/console/profile'), 'profile-read').data
  const updateProfileBody = profilePayload(originalProfile, Number(originalProfile.revision))
  updateProfileBody.displayName = `CTR-812 isolated ${runID}`
  const profileKey = idempotency('profile-update')
  const profileUpdate = requireCodeZero(await bff('/api/v1/console/profile', {
    method: 'PUT',
    headers: { 'idempotency-key': profileKey },
    body: JSON.stringify(updateProfileBody)
  }), 'profile-update')
  const profileReplay = requireCodeZero(await bff('/api/v1/console/profile', {
    method: 'PUT',
    headers: { 'idempotency-key': profileKey },
    body: JSON.stringify(updateProfileBody)
  }), 'profile-replay')
  if (profileReplay.body?.replayed !== true && profileReplay.data?.replayed !== true) {
    throw new Error('profile idempotency replay was not observed')
  }
  const changedProfile = profileUpdate.data?.profile || profileUpdate.data
  const restoreRevision = Number(changedProfile?.revision)
  if (!Number.isInteger(restoreRevision) || restoreRevision <= Number(originalProfile.revision)) {
    throw new Error('profile revision did not advance')
  }
  const restoredProfile = requireCodeZero(await bff('/api/v1/console/profile', {
    method: 'PUT',
    headers: { 'idempotency-key': idempotency('profile-restore') },
    body: JSON.stringify(profilePayload(originalProfile, restoreRevision))
  }), 'profile-restore')
  if (restoredProfile.data?.displayName !== (originalProfile.displayName ?? null)) {
    throw new Error('profile semantic restore failed')
  }
  results.profile = {
    initialRevision: Number(originalProfile.revision),
    updatedRevision: restoreRevision,
    restoredRevision: Number(restoredProfile.data?.revision),
    replayed: true
  }
  step('profile-update-replay-restore')

  const settingValues = requireCodeZero(
    await bff('/api/v1/console/settings/values?status=active'),
    'settings-read'
  ).data?.items || []
  const setting = settingValues.find(item => (
    item?.settingKey === 'feedback.reporter.enabled'
    && item?.editableInUi === true
    && item?.hasCustomValue === true
    && Number(item?.revision) > 0
  ))
  if (!setting) throw new Error('safe editable setting fixture is unavailable')
  const settingKey = encodeURIComponent(setting.settingKey)
  const settingBody = {
    scopeKey: setting.scopeKey || '__tenant__',
    value: setting.value,
    expectedRevision: Number(setting.revision)
  }
  const settingIdempotency = idempotency('setting-update')
  const settingUpdate = requireCodeZero(await bff(`/api/v1/console/settings/values/${settingKey}`, {
    method: 'PUT',
    headers: { 'idempotency-key': settingIdempotency },
    body: JSON.stringify(settingBody)
  }), 'setting-update')
  const settingReplay = requireCodeZero(await bff(`/api/v1/console/settings/values/${settingKey}`, {
    method: 'PUT',
    headers: { 'idempotency-key': settingIdempotency },
    body: JSON.stringify(settingBody)
  }), 'setting-replay')
  if (settingReplay.data?.replayed !== true && settingReplay.body?.replayed !== true) {
    throw new Error('setting idempotency replay was not observed')
  }
  const settingRevision = Number(settingUpdate.data?.revision)
  const settingRestore = requireCodeZero(await bff(`/api/v1/console/settings/values/${settingKey}`, {
    method: 'PUT',
    headers: { 'idempotency-key': idempotency('setting-restore') },
    body: JSON.stringify({
      scopeKey: setting.scopeKey || '__tenant__',
      value: setting.value,
      expectedRevision: settingRevision
    })
  }), 'setting-restore')
  results.setting = {
    key: setting.settingKey,
    initialRevision: Number(setting.revision),
    updatedRevision: settingRevision,
    restoredRevision: Number(settingRestore.data?.revision),
    replayed: true
  }
  step('setting-update-replay-restore', { settingKey: setting.settingKey })

  const deptCode = `CTR812D${runID.slice(-8)}`
  const userUID = `ctr812-${runID.slice(-10)}-${randomBytes(3).toString('hex')}`
  requireCodeZero(await bff('/api/v1/console/directory/departments', {
    method: 'POST',
    headers: { 'idempotency-key': idempotency('department-create') },
    body: JSON.stringify({
      deptCode,
      deptName: 'CTR-812 Isolated Department',
      orgType: 'department',
      description: 'CTR-812 isolated acceptance fixture',
      status: 'active'
    })
  }), 'department-create')
  requireCodeZero(await bff(`/api/v1/console/directory/departments/${encodeURIComponent(deptCode)}`, {
    method: 'PATCH',
    headers: { 'idempotency-key': idempotency('department-update') },
    body: JSON.stringify({ description: 'CTR-812 isolated acceptance updated' })
  }), 'department-update')
  requireCodeZero(await bff('/api/v1/console/directory/users', {
    method: 'POST',
    headers: { 'idempotency-key': idempotency('directory-user-create') },
    body: JSON.stringify({
      uid: userUID,
      username: userUID,
      displayName: 'CTR-812 Isolated User',
      realName: 'CTR-812 Isolated User',
      userType: 'employee',
      status: 'active',
      remark: 'CTR-812 isolated acceptance fixture'
    })
  }), 'directory-user-create')
  requireCodeZero(await bff(`/api/v1/console/directory/users/${encodeURIComponent(userUID)}`, {
    method: 'PATCH',
    headers: { 'idempotency-key': idempotency('directory-user-update') },
    body: JSON.stringify({ positionTitle: 'CTR-812 Tester' })
  }), 'directory-user-update')
  results.directory = {
    departmentFingerprint: fingerprint(deptCode),
    userFingerprint: fingerprint(userUID),
    created: true,
    updated: true
  }
  step('directory-create-update')

  const userRawSession = `cs_${randomBytes(32).toString('base64url')}`
  const userStoredSession = `sha256_${sha256(userRawSession)}`
  requireCodeZero(await runtime('/v1/console/auth/sessions', {
    method: 'POST',
    headers: { 'idempotency-key': idempotency('test-user-session') },
    body: JSON.stringify({
      sessionIdHash: userStoredSession,
      uid: userUID,
      authProvider: 'ctr812_test',
      ttlSeconds: 3600,
      deviceSummary: 'CTR-812 offboarding acceptance'
    })
  }), 'test-user-session')
  const resolvedSession = requireCodeZero(await runtime('/v1/console/auth/sessions/resolve', {
    method: 'POST',
    body: JSON.stringify({ sessionIdHash: userStoredSession, touch: false })
  }), 'test-user-session-resolve')
  if (resolvedSession.data?.uid !== userUID) {
    throw new Error('test user session resolve mismatch')
  }

  const refreshTokenHash = `sha256_${sha256(`ctr812-refresh-${randomUUID()}`)}`
  const refreshFamily = `ctr812-family-${randomUUID()}`
  requireCodeZero(await runtime('/v1/console/auth/oidc/refresh-tokens', {
    method: 'POST',
    headers: { 'idempotency-key': idempotency('refresh-issue') },
    body: JSON.stringify({
      tokenHash: refreshTokenHash,
      tokenFamily: refreshFamily,
      clientId: 'console',
      sessionIdHash: userStoredSession,
      ttlSeconds: 3600
    })
  }), 'refresh-issue')
  const refreshConsume = requireCodeZero(await runtime('/v1/console/auth/oidc/refresh-tokens/consume', {
    method: 'POST',
    body: JSON.stringify({ tokenHash: refreshTokenHash, clientId: 'console' })
  }), 'refresh-consume')
  if (refreshConsume.data?.tokenFamily !== refreshFamily) {
    throw new Error('refresh token family mismatch')
  }
  const reuse = await runtime('/v1/console/auth/oidc/refresh-tokens/consume', {
    method: 'POST',
    body: JSON.stringify({ tokenHash: refreshTokenHash, clientId: 'console' })
  }, [400])
  if (errorCode(reuse.body, reuse.response.status) !== 'invalid_grant') {
    throw new Error('refresh token reuse did not fail closed')
  }

  const offboardingRefreshHash = `sha256_${sha256(`ctr812-offboard-refresh-${randomUUID()}`)}`
  const offboardingFamily = `ctr812-offboard-family-${randomUUID()}`
  requireCodeZero(await runtime('/v1/console/auth/oidc/refresh-tokens', {
    method: 'POST',
    headers: { 'idempotency-key': idempotency('offboard-refresh-issue') },
    body: JSON.stringify({
      tokenHash: offboardingRefreshHash,
      tokenFamily: offboardingFamily,
      clientId: 'console',
      sessionIdHash: userStoredSession,
      ttlSeconds: 3600
    })
  }), 'offboard-refresh-issue')
  results.auth = {
    sessionIssued: true,
    sessionResolved: true,
    refreshIssued: true,
    refreshConsumed: true,
    refreshReuseRejected: true
  }
  step('auth-session-refresh-reuse')

  const secretCode = `ctr812.integration.${runID}.${randomBytes(3).toString('hex')}`
  const secretValues = [
    `ctr812-v1-${randomBytes(18).toString('base64url')}`,
    `ctr812-v2-${randomBytes(18).toString('base64url')}`,
    `ctr812-v3-${randomBytes(18).toString('base64url')}`
  ]
  const createdSecret = requireCodeZero(await bff('/api/v1/console/vault/secrets', {
    method: 'POST',
    headers: { 'idempotency-key': idempotency('vault-create') },
    body: JSON.stringify({
      secretCode,
      secretName: 'CTR-812 Isolated Integration Secret',
      secretType: 'api_key',
      usageType: 'integration',
      ownerType: 'integration',
      ownerKey: `ctr812.integration.${runID}`,
      storageBackend: 'db_encrypted',
      material: { plaintext: secretValues[0] },
      revealPolicy: 'approval'
    })
  }), 'vault-create')
  if (Number(createdSecret.data?.currentVersionNo) !== 1) {
    throw new Error('vault initial version mismatch')
  }
  const appendedVersion = requireCodeZero(await bff(
    `/api/v1/console/vault/secrets/${encodeURIComponent(secretCode)}/versions`,
    {
      method: 'POST',
      headers: { 'idempotency-key': idempotency('vault-version') },
      body: JSON.stringify({
        storageBackend: 'db_encrypted',
        material: { plaintext: secretValues[1] }
      })
    }
  ), 'vault-version')
  if (Number(appendedVersion.data?.versionNo) !== 2 || appendedVersion.data?.current !== false) {
    throw new Error('vault appended version mismatch')
  }
  const rotatedVersion = requireCodeZero(await bff(
    `/api/v1/console/vault/secrets/${encodeURIComponent(secretCode)}/rotate`,
    {
      method: 'POST',
      headers: { 'idempotency-key': idempotency('vault-rotate') },
      body: JSON.stringify({
        storageBackend: 'db_encrypted',
        material: { plaintext: secretValues[2] }
      })
    }
  ), 'vault-rotate')
  if (Number(rotatedVersion.data?.versionNo) !== 3 || rotatedVersion.data?.current !== true) {
    throw new Error('vault current rotation mismatch')
  }
  const revealedSecret = requireCodeZero(await bff(
    `/api/v1/console/vault/secrets/${encodeURIComponent(secretCode)}/reveal`,
    {
      method: 'POST',
      body: JSON.stringify({
        versionNo: 3,
        reason: 'CTR-812 isolated acceptance verification',
        approvalCode: 'CTR-812-ISOLATED'
      })
    }
  ), 'vault-reveal')
  if (revealedSecret.data?.plaintext !== secretValues[2]) {
    throw new Error('vault reveal material mismatch')
  }
  results.vault = {
    secretFingerprint: fingerprint(secretCode),
    versionsCreated: 3,
    rotatedCurrent: true,
    revealedAndMatched: true
  }
  step('vault-create-version-rotate-reveal')

  const integrationCode = `ctr812.local.${runID}.${randomBytes(2).toString('hex')}`
  const integrationCreate = requireCodeZero(await bff('/api/v1/console/integrations', {
    method: 'POST',
    headers: { 'idempotency-key': idempotency('integration-create') },
    body: JSON.stringify({
      integrationCode,
      integrationType: 'ctr812_local',
      integrationName: 'CTR-812 Local Resolve',
      category: 'test',
      providerCode: 'ctr812',
      config: { mode: 'isolated', outbound: false },
      credential: { secretCode, versionNo: 3 },
      status: 'active'
    })
  }), 'integration-create')
  if (integrationCreate.data?.integrationCode !== integrationCode) {
    throw new Error('integration create projection mismatch')
  }
  requireCodeZero(await bff(`/api/v1/console/integrations/${encodeURIComponent(integrationCode)}`, {
    method: 'PATCH',
    headers: { 'idempotency-key': idempotency('integration-update') },
    body: JSON.stringify({ integrationName: 'CTR-812 Local Resolve Updated' })
  }), 'integration-update')
  const integrationCheckKey = idempotency('integration-check')
  const integrationCheck = requireCodeZero(await bff(
    `/api/v1/console/integrations/${encodeURIComponent(integrationCode)}/check`,
    {
      method: 'POST',
      headers: { 'idempotency-key': integrationCheckKey },
      body: JSON.stringify({})
    }
  ), 'integration-check')
  if (
    integrationCheck.data?.status !== 'healthy'
    || integrationCheck.data?.summary?.checkMode !== 'vault_resolve_only'
  ) {
    throw new Error('isolated integration check did not resolve Vault material locally')
  }
  const integrationCheckReplay = requireCodeZero(await bff(
    `/api/v1/console/integrations/${encodeURIComponent(integrationCode)}/check`,
    {
      method: 'POST',
      headers: { 'idempotency-key': integrationCheckKey },
      body: JSON.stringify({})
    }
  ), 'integration-check-replay')
  if (integrationCheckReplay.data?.replayed !== true && integrationCheckReplay.body?.replayed !== true) {
    throw new Error('integration check retry did not replay')
  }
  requireCodeZero(await bff(`/api/v1/console/integrations/${encodeURIComponent(integrationCode)}`, {
    method: 'PATCH',
    headers: { 'idempotency-key': idempotency('integration-deactivate') },
    body: JSON.stringify({ status: 'inactive' })
  }), 'integration-deactivate')
  results.integration = {
    integrationFingerprint: fingerprint(integrationCode),
    created: true,
    updated: true,
    vaultResolveOnly: true,
    checkHealthy: true,
    retryReplayed: true,
    externalRequestSent: false,
    deactivated: true
  }
  step('integration-create-update-check-retry-deactivate')

  const actionableKey = `ctr812-actionable-${randomUUID()}`
  const notificationIdempotency = `ctr812-notification-${randomUUID()}`
  const notificationRequest = {
    sourceAppCode: 'console',
    eventType: 'ctr812.isolated.acceptance',
    category: 'system',
    severity: 'info',
    title: 'CTR-812 isolated notification',
    summary: 'Tenant Runtime notification acceptance',
    body: 'Synthetic isolated acceptance record; no external delivery.',
    actionUrl: `${consoleBaseURL}/notifications`,
    bizType: 'ctr812_acceptance',
    bizId: runID,
    idempotencyKey: notificationIdempotency,
    recipients: [session.subjectUid],
    channels: ['in_app'],
    metadataJson: JSON.stringify({ schemaVersion: 'ctr812.acceptance.v1' }),
    createdBy: 'ctr812-acceptance',
    requestHash: digestCommand({
      idempotencyKey: notificationIdempotency,
      recipientFingerprint: fingerprint(session.subjectUid)
    }),
    actionable: {
      sourceAppCode: 'console',
      actionableKey,
      targetAppCode: 'console',
      bizType: 'ctr812_acceptance',
      bizId: runID,
      businessKey: `ctr812:${runID}`,
      state: 'pending',
      objectVersion: 'v1'
    }
  }
  const published = requireCodeZero(await runtime('/v1/console/notifications/publish-canonical', {
    method: 'POST',
    body: JSON.stringify(notificationRequest)
  }), 'notification-publish')
  const notificationID = published.data?.notificationId
  if (!notificationID || published.data?.replayed !== false) {
    throw new Error('canonical notification publish mismatch')
  }
  const publishReplay = requireCodeZero(await runtime('/v1/console/notifications/publish-canonical', {
    method: 'POST',
    body: JSON.stringify(notificationRequest)
  }), 'notification-publish-replay')
  if (publishReplay.data?.notificationId !== notificationID || publishReplay.data?.replayed !== true) {
    throw new Error('canonical notification replay mismatch')
  }
  const actionableResolved = requireCodeZero(await runtime('/v1/console/notifications/actionable-lifecycle', {
    method: 'POST',
    body: JSON.stringify({
      sourceAppCode: 'console',
      actionableKey,
      expectedVersion: 'v1',
      nextVersion: 'v2',
      state: 'resolved',
      recipients: [session.subjectUid]
    })
  }), 'actionable-resolve')
  if (Number(actionableResolved.data?.updated) !== 1) {
    throw new Error('actionable lifecycle update mismatch')
  }
  const actionableReplay = requireCodeZero(await runtime('/v1/console/notifications/actionable-lifecycle', {
    method: 'POST',
    body: JSON.stringify({
      sourceAppCode: 'console',
      actionableKey,
      expectedVersion: 'v1',
      nextVersion: 'v2',
      state: 'resolved',
      recipients: [session.subjectUid]
    })
  }), 'actionable-replay')
  if (Number(actionableReplay.data?.replayed) !== 1) {
    throw new Error('actionable lifecycle replay mismatch')
  }
  const notificationList = requireCodeZero(
    await bff('/api/v1/console/notifications?status=all&sourceAppCode=console&limit=100'),
    'notification-list'
  )
  const notificationItems = notificationList.data?.items || []
  if (!notificationItems.some(item => item.notificationId === notificationID)) {
    throw new Error('published notification is not visible through Console BFF')
  }
  requireCodeZero(await bff(
    `/api/v1/console/notifications/${encodeURIComponent(notificationID)}/read`,
    {
      method: 'POST',
      headers: { 'idempotency-key': idempotency('notification-read') },
      body: JSON.stringify({})
    }
  ), 'notification-read')
  requireCodeZero(await bff(
    `/api/v1/console/notifications/${encodeURIComponent(notificationID)}/archive`,
    {
      method: 'POST',
      headers: { 'idempotency-key': idempotency('notification-archive') },
      body: JSON.stringify({})
    }
  ), 'notification-archive')
  results.notification = {
    notificationFingerprint: fingerprint(notificationID),
    inAppOnly: true,
    externalDeliveryAttempted: false,
    published: true,
    publishReplayed: true,
    actionableResolved: true,
    actionableReplayed: true,
    read: true,
    archived: true
  }
  step('notification-actionable-read-archive')

  const lifecycleCommand = {
    employeeUid: userUID,
    lifecycleType: 'offboarding',
    sourceRevision: 1,
    snapshotHash: digestCommand({
      employeeUid: userUID,
      lifecycleType: 'offboarding',
      sourceRevision: 1
    }),
    originalActorUid: session.subjectUid
  }
  const lifecycleEnvelope = {
    targetApp: 'console',
    operationId: randomUUID(),
    operationCode: 'people.directory.offboarding-disable.v1',
    requiredCapability: 'console:directory-offboarding:disable',
    idempotencyKey: `ctr812-people-offboarding-${randomUUID()}`,
    commandSchemaVersion: 'v1',
    commandSha256: digestCommand(lifecycleCommand),
    command: lifecycleCommand
  }
  const lifecyclePath = `/v1/console/directory/service/users/${encodeURIComponent(userUID)}/offboarding`
  async function invokeLifecycleCommand() {
    const signedAt = String(Date.now())
    const requestID = randomUUID()
    const sourceDeployment = 'people-ctr812-test'
    const sourceClient = 'ctr812-people-client'
    const canonical = [
      'POST',
      lifecyclePath,
      tenant,
      sourceDeployment,
      runtimeDeployment,
      'people',
      sourceClient,
      'console',
      lifecycleEnvelope.operationId,
      lifecycleEnvelope.operationCode,
      lifecycleEnvelope.requiredCapability,
      lifecycleEnvelope.idempotencyKey,
      lifecycleEnvelope.commandSchemaVersion,
      lifecycleEnvelope.commandSha256,
      requestID,
      signedAt
    ].join('\n')
    const signature = createHmac('sha256', runtimeToken)
      .update(canonical)
      .digest('base64url')
    return await runtime(lifecyclePath, {
      method: 'POST',
      headers: {
        'x-request-id': requestID,
        'x-hzy-service-command-tenant': tenant,
        'x-hzy-service-command-source-deployment': sourceDeployment,
        'x-hzy-service-command-target-deployment': runtimeDeployment,
        'x-hzy-service-command-source-app': 'people',
        'x-hzy-service-command-target-app': 'console',
        'x-hzy-service-command-source-client': sourceClient,
        'x-hzy-service-command-operation-id': lifecycleEnvelope.operationId,
        'x-hzy-service-command-operation-code': lifecycleEnvelope.operationCode,
        'x-hzy-service-command-capability': lifecycleEnvelope.requiredCapability,
        'x-hzy-service-command-idempotency-key': lifecycleEnvelope.idempotencyKey,
        'x-hzy-service-command-schema-version': lifecycleEnvelope.commandSchemaVersion,
        'x-hzy-service-command-sha256': lifecycleEnvelope.commandSha256,
        'x-hzy-service-command-signed-at': signedAt,
        'x-hzy-service-command-signature': signature
      },
      body: JSON.stringify({ serviceCommand: lifecycleEnvelope })
    })
  }
  const offboarding = requireCodeZero(await invokeLifecycleCommand(), 'people-offboarding')
  if (
    offboarding.data?.result?.appliedRevision !== 1
    || offboarding.data?.result?.platformStatus !== 'pending'
  ) {
    throw new Error('People offboarding lifecycle result mismatch')
  }
  const offboardingReplay = requireCodeZero(await invokeLifecycleCommand(), 'people-offboarding-replay')
  if (offboardingReplay.data?.idempotent !== true) {
    throw new Error('People offboarding receipt replay mismatch')
  }
  const revokedSession = await runtime('/v1/console/auth/sessions/resolve', {
    method: 'POST',
    body: JSON.stringify({ sessionIdHash: userStoredSession, touch: false })
  }, [401])
  if (errorCode(revokedSession.body, revokedSession.response.status) !== 'auth_session_invalid') {
    throw new Error('offboarding did not revoke the test user session')
  }
  const revokedRefresh = await runtime('/v1/console/auth/oidc/refresh-tokens/consume', {
    method: 'POST',
    body: JSON.stringify({ tokenHash: offboardingRefreshHash, clientId: 'console' })
  }, [400])
  if (errorCode(revokedRefresh.body, revokedRefresh.response.status) !== 'invalid_grant') {
    throw new Error('offboarding did not revoke the test user refresh family')
  }
  results.offboarding = {
    commandFingerprint: fingerprint(lifecycleEnvelope.operationId),
    appliedRevision: 1,
    receiptReplayed: true,
    sessionRevoked: true,
    refreshRevoked: true,
    platformOperationCreated: true
  }
  step('people-offboarding-revocation')

  requireCodeZero(await bff(`/api/v1/console/directory/departments/${encodeURIComponent(deptCode)}`, {
    method: 'DELETE',
    headers: { 'idempotency-key': idempotency('department-delete') }
  }), 'department-delete')
  results.directory.departmentDeleted = true
  results.directory.userOffboarded = true
  step('directory-fixture-cleanup')

  let claimedOperation = null
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    const claim = requireCodeZero(await runtime('/v1/console/platform-lifecycle/drain/claim', {
      method: 'POST',
      body: JSON.stringify({})
    }), `platform-operation-claim-${attempt}`)
    if (!claim.data?.operationId) {
      throw new Error(`platform lifecycle operation was not claimable at attempt ${attempt}`)
    }
    if (claim.data?.operationCode !== 'console.platform.offboarding-revoke.v1') {
      throw new Error('unexpected platform lifecycle operation was claimed')
    }
    claimedOperation = claim.data
    requireCodeZero(await runtime('/v1/console/platform-lifecycle/drain/checkpoint', {
      method: 'POST',
      body: JSON.stringify({
        operationId: claim.data.operationId,
        fencingToken: claim.data.fencingToken,
        outcome: 'failed',
        failure: {
          status: 'retry_wait',
          code: 'ctr812_synthetic_retry',
          classification: 'transient',
          summary: 'CTR-812 isolated retry acceptance'
        }
      })
    }), `platform-operation-checkpoint-${attempt}`)
    step('operation-retry-attempt', { attempt })
    if (attempt < 8) await sleep(31_000)
  }
  requireCodeZero(await runtime('/v1/console/platform-lifecycle/drain/claim', {
    method: 'POST',
    body: JSON.stringify({})
  }), 'platform-operation-dead-letter-transition')
  const beforeRetry = requireCodeZero(await bff(
    `/api/v1/console/authorization-lifecycle/operations?uid=${encodeURIComponent(userUID)}&limit=10`
  ), 'platform-operation-list-before-retry')
  const beforeItem = (beforeRetry.data?.items || []).find(item => item.operationId === claimedOperation.operationId)
  if (beforeItem?.status !== 'dead_letter' || Number(beforeItem?.attemptCount) !== 8) {
    throw new Error('platform lifecycle operation did not reach dead_letter after eight attempts')
  }
  const manualRetry = requireCodeZero(await bff('/api/v1/console/authorization-lifecycle/retry', {
    method: 'POST',
    body: JSON.stringify({
      uid: userUID,
      phase: 'offboarding_authorization_reclaim'
    })
  }), 'platform-operation-manual-retry')
  const afterRetry = requireCodeZero(await bff(
    `/api/v1/console/authorization-lifecycle/operations?uid=${encodeURIComponent(userUID)}&limit=10`
  ), 'platform-operation-list-after-retry')
  const afterItem = (afterRetry.data?.items || []).find(item => item.operationId === claimedOperation.operationId)
  if (afterItem?.status !== 'cancelled') {
    throw new Error('successful manual retry did not cancel the dead-letter source')
  }
  results.operationRetry = {
    operationFingerprint: fingerprint(claimedOperation.operationId),
    attempts: 8,
    deadLetterObserved: true,
    manualRetrySucceeded: Boolean(manualRetry.data),
    deadLetterCancelled: true
  }
  step('operation-dead-letter-manual-retry')

  const vaultList = requireCodeZero(
    await bff(`/api/v1/console/vault/secrets?search=${encodeURIComponent(secretCode)}`),
    'vault-list-final'
  )
  if (!(vaultList.data?.items || []).some(item => item.secretCode === secretCode)) {
    throw new Error('Vault fixture is not visible through final BFF read')
  }
  const integrationFinal = requireCodeZero(
    await bff(`/api/v1/console/integrations/${encodeURIComponent(integrationCode)}`),
    'integration-final'
  )
  if (integrationFinal.data?.status !== 'inactive') {
    throw new Error('Integration fixture was not deactivated')
  }

  const completedAt = new Date().toISOString()
  const evidence = {
    schemaVersion: 'ctr812-console-test-write-chain-evidence.v1',
    testId: `CTR-812-${runID}`,
    startedFromSessionIssuedAt: session.issuedAt,
    completedAt,
    environment: 'test',
    tenant,
    consoleDeployment,
    runtimeDeployment,
    consoleBaseURL,
    runtimeEndpoint: 'loopback:18083',
    productionMutationPerformed: false,
    externalNotificationSent: false,
    externalProviderRequestSent: false,
    results,
    browserException: {
      status: 'open',
      code: 'test_upstream_oidc_configuration_missing',
      impact: 'Authenticated browser UI acceptance unavailable; HTTPS Console BFF acceptance completed with a Runtime-issued isolated session.'
    }
  }
  await writeFile(evidenceFile, `${JSON.stringify(evidence, null, 2)}\n`, {
    mode: 0o600,
    flag: 'wx'
  })
  await chmod(evidenceFile, 0o600)
  console.info(JSON.stringify({
    status: 'passed',
    testId: evidence.testId,
    completedAt,
    evidenceFile,
    evidenceSha256: sha256(JSON.stringify(evidence, null, 2) + '\n'),
    browserException: evidence.browserException.code
  }))
}

main().catch((error) => {
  console.error(`[ctr812-write-chain] ${error.message}`)
  process.exitCode = 1
})
