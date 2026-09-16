import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

function workspaceSource(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
}

test('Directory Connector uses Tenant Runtime for configuration, lease, completion and sync', () => {
  const enrollmentRoute = source('server/api/v1/console/directory-connectors/enroll.post.ts')
  const runtime = workspaceSource('data-runtime/internal/apps/directory/console_connector_management.go')
  const enrollmentRuntime = workspaceSource('data-runtime/internal/apps/directory/connector_enrollment.go')
  const sourceRuntime = workspaceSource('data-runtime/internal/apps/console/directory_sources.go')
  const tenantRuntimeClient = workspaceSource('foundation/server/utils/consoleTenantRuntimeClient.ts')
  const runtimeClient = workspaceSource('data-runtime/internal/directoryconnector/runtime_client.go')

  assert.match(runtime, /rsa\.EncryptOAEP/)
  assert.match(sourceRuntime, /rsa\.EncryptOAEP/)
  assert.match(runtime, /initialPasswordCiphertext/)
  assert.match(runtime, /currentPasswordCiphertext/)
  assert.match(runtime, /newPasswordCiphertext/)
  assert.doesNotMatch(runtime, /"initialPassword":\s*password/)
  assert.match(runtime, /beginConsoleMutation/)
  assert.match(runtime, /finishConsoleMutation/)
  assert.match(enrollmentRoute, /redeemConsoleDirectoryConnectorEnrollment/)
  assert.doesNotMatch(enrollmentRoute, /server\/utils\/db|directoryConnector/)
  assert.match(tenantRuntimeClient, /\/v1\/console\/directory-connectors\/enroll/)
  assert.match(tenantRuntimeClient, /console:directory-connector:enroll/)
  assert.match(enrollmentRuntime, /ed25519\.Verify/)
  assert.match(enrollmentRuntime, /directory_connector_enrollments/)
  assert.match(enrollmentRuntime, /directory_connector_enrollment_replayed/)
  assert.doesNotMatch(enrollmentRuntime, /client_secret|clientSecret/)
  assert.match(runtimeClient, /\/runtime\/internal\/directory-connector\/configuration/)
  assert.match(runtimeClient, /\/runtime\/internal\/directory-connector\/commands\/lease/)
  assert.match(runtimeClient, /\/runtime\/internal\/directory-connector\/sync/)
  assert.throws(() => source('server/utils/directoryConnector.ts'), /ENOENT/)
})

test('Directory source CRUD and Connector configuration use the customer Tenant Runtime Vault boundary', () => {
  const runtime = workspaceSource('data-runtime/internal/apps/console/directory_sources.go')
  const client = workspaceSource('foundation/server/utils/consoleTenantRuntimeClient.ts')
  const page = source('app/pages/directory/sources.vue')

  for (const routePath of [
    'server/api/v1/console/directory/sources/index.get.ts',
    'server/api/v1/console/directory/sources/index.post.ts',
    'server/api/v1/console/directory/sources/[providerCode].get.ts',
    'server/api/v1/console/directory/sources/[providerCode].put.ts'
  ]) {
    const route = source(routePath)
    assert.match(route, /consoleTenantRuntimeClient/)
    assert.doesNotMatch(route, /server\/utils\/directorySources|server\/utils\/db/)
  }
  assert.match(client, /console:directory-source:view/)
  assert.match(client, /console:directory-source:edit/)
  assert.match(runtime, /beginMutation/)
  assert.match(runtime, /finishMutation/)
  assert.match(runtime, /persistDirectorySourceSecret/)
  assert.match(runtime, /ResolveVaultSecret/)
  assert.match(runtime, /rsa\.EncryptOAEP/)
  assert.match(runtime, /directory_connector_configuration/)
  assert.match(page, /Console Vault（加密）/)
  assert.match(page, /\{ plaintext: form\.backendSecretRef \}/)
  assert.match(page, /method: 'PUT',[\s\S]{0,120}'Idempotency-Key': crypto\.randomUUID\(\)/)
  assert.throws(() => source('server/utils/directorySources.ts'), /ENOENT/)
})

test('LDAP create and password APIs are asynchronous operation endpoints', () => {
  const users = source('server/api/v1/console/directory/users/index.post.ts')
  const password = source('server/api/v1/console/directory/me/password.post.ts')
  const operation = source('server/api/v1/console/directory/operations/[operationId].get.ts')
  const client = workspaceSource('foundation/server/utils/consoleTenantRuntimeClient.ts')

  assert.match(users, /queueConsoleDirectoryLDAPUserCreate/)
  assert.match(users, /requireIdempotencyKey\(event\)/)
  assert.match(users, /setResponseStatus\(event, 202\)/)
  assert.match(password, /queueConsoleDirectoryPasswordChange/)
  assert.match(password, /requireIdempotencyKey\(event\)/)
  assert.match(password, /setResponseStatus\(event, 202\)/)
  assert.match(operation, /getConsoleDirectoryConnectorOperation/)
  assert.match(client, /console:directory-connector:execute/)
  assert.match(client, /console:directory-connector:view/)
  assert.match(client, /\/v1\/console\/directory\/connector-operations\/users/)
  assert.match(client, /\/v1\/console\/directory\/me\/password/)
})

test('LDAP connectivity test is executed by the customer-side Connector without exposing the Vault password', () => {
  const runtime = workspaceSource('data-runtime/internal/apps/directory/console_connector_management.go')
  const route = source('server/api/v1/console/directory/sources/ldap/test.post.ts')
  const page = source('app/pages/directory/sources.vue')

  assert.match(route, /directory_sources', 'edit'/)
  assert.match(route, /queueConsoleDirectoryLDAPTest/)
  assert.match(route, /requireIdempotencyKey\(event\)/)
  assert.match(runtime, /console\.directory-connector\.test-connection\.v1/)
  assert.match(runtime, /connectivity_status='checking'/)
  assert.match(page, /测试连接与认证/)
  assert.match(page, /'Idempotency-Key': crypto\.randomUUID\(\)/)
  assert.match(page, /ldap_invalid_credentials/)
  assert.doesNotMatch(page, /bindPasswordCiphertext/)
})

test('Console generates the LDAP initial password and never persists it in the replayable receipt', () => {
  const runtime = workspaceSource('data-runtime/internal/apps/directory/console_connector_management.go')

  // 调用方不再必须提供明文密码：People 受控入职要求 People 的数据库、
  // operation command 和日志都不得经手初始密码。
  assert.match(runtime, /func consoleLDAPPassword\(value any, uid string\) \(string, bool, error\)/)
  assert.match(runtime, /func generateConsoleLDAPPassword\(uid string\) \(string, error\)/)
  assert.match(runtime, /rand\.Int\(rand\.Reader/)

  // 生成的明文只允许出现在本次响应的副本里。finishConsoleMutation 会把
  // result 持久化到 console_mutation_receipts 供幂等重放读取，因此明文
  // 绝不能进 result —— 否则重放同一个 Idempotency-Key 就能反复取回密码。
  const queueBody = runtime.slice(
    runtime.indexOf('func (a *Adapter) ConsoleQueueLDAPUserCreate'),
    runtime.indexOf('func (a *Adapter) ConsoleQueueSelfLDAPPasswordChange')
  )
  assert.ok(queueBody.length > 0, 'ConsoleQueueLDAPUserCreate body must be locatable')
  assert.match(queueBody, /revealed\["initialPassword"\] = password/)
  assert.doesNotMatch(queueBody, /result\["initialPassword"\]/)
  assert.ok(
    queueBody.indexOf('finishConsoleMutation') < queueBody.indexOf('revealed["initialPassword"]'),
    'the plaintext copy must be built only after the receipt is persisted'
  )

  // 自助改密仍必须由用户自己提供新密码，不得替他生成一个他不知道的密码。
  const selfServiceBody = runtime.slice(runtime.indexOf('func (a *Adapter) ConsoleQueueSelfLDAPPasswordChange'))
  assert.match(selfServiceBody, /body\["newPassword"\] == nil \|\| strings\.TrimSpace/)
})

test('activation credentials reach the employee directly and are never returned to the caller', () => {
  const createRoute = source('server/api/v1/console/directory/users/index.post.ts')
  const redeemRoute = source('server/api/v1/console/directory/activation/redeem.post.ts')
  const inspectRoute = source('server/api/v1/console/directory/activation/inspect.post.ts')
  const pageAccess = source('server/middleware/page-access.ts')
  const runtime = workspaceSource('data-runtime/internal/apps/directory/console_activation_credential.go')
  const agent = workspaceSource('data-runtime/internal/directoryconnector/agent.go')

  // 令牌由 Console 直接投递给员工本人，并从响应里剔除。People 受控入职
  // 按约束不得接收明文凭据，HR 也不需要经手。
  assert.match(createRoute, /sendNotification/)
  assert.match(createRoute, /const \{ activationToken: _token, \.\.\.safeData \} = data/)
  assert.match(createRoute, /activationDelivered/)
  assert.doesNotMatch(createRoute, /data: \{ \.\.\.data \}/)

  // 兑换只回传 uid，不回传令牌、DN 或其他目录内部字段。
  assert.match(redeemRoute, /data: \{ uid:/)
  assert.doesNotMatch(redeemRoute, /activationToken/)

  // 员工此时没有账号，两个路由和设密页都必须能在未登录状态访问。
  for (const route of [redeemRoute, inspectRoute]) {
    assert.doesNotMatch(route, /requirePermission|requireConsoleRequestUid/)
  }
  assert.match(pageAccess, /pathname === '\/set-password'/)

  // 库里只存令牌哈希：表结构不得出现任何保存明文令牌的列。
  const migration = workspaceSource('console/docs/sql/Console-SQL-Migration-v2.4-directory-activation-credentials.sql')
  assert.match(migration, /`token_sha256` CHAR\(64\) NOT NULL/)
  assert.doesNotMatch(migration, /`token`\s+(VARCHAR|TEXT|CHAR)/)
  assert.match(migration, /UNIQUE KEY `uk_directory_activation_token` \(`token_sha256`\)/)

  // 写入的是哈希而不是明文，失败原因统一，不泄露令牌是否存在。
  assert.match(runtime, /consoleActivationTokenHash\(token\), purpose/)
  assert.match(runtime, /sha256\.Sum256/)
  assert.match(runtime, /consoleActivationInvalid/)

  // 管理员重设密码不需要当前密码，覆盖员工从未见过初始密码的场景。
  assert.match(agent, /console\.directory-connector\.reset-password\.v1/)
  assert.match(agent, /resetLDAPPassword/)
})
