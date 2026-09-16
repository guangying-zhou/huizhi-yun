import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

function assertBefore(content: string, left: string, right: string) {
  const leftIndex = content.indexOf(left)
  const rightIndex = content.indexOf(right)

  assert.notEqual(leftIndex, -1, `Missing ${left}`)
  assert.notEqual(rightIndex, -1, `Missing ${right}`)
  assert.ok(leftIndex < rightIndex, `${left} must appear before ${right}`)
}

describe('Console notification publish permissions', () => {
  test('service publish API requires notifications:publish before reading payload', () => {
    const content = source('server/api/v1/console/notifications/publish.post.ts')

    assertBefore(
      content,
      'requireConsoleServiceActor(event, \'notifications\', \'notifications:publish\')',
      'readBody(event)'
    )
    assertBefore(content, 'assertNotificationPublisherIdentity(', 'readBody(event)')
    assert.match(content, /resolveConsoleRuntimeBinding\(event\)/)
    assertBefore(
      content,
      'requireConsoleServiceActor(event, \'notifications\', \'notifications:publish\')',
      'publishPortalNotification(body, actor, event)'
    )

    const idempotency = source('server/utils/portalNotificationIdempotency.ts')
    assert.match(idempotency, /if \(!idempotencyKey \|\| idempotencyKey\.length > 191\)/)
    assert.match(idempotency, /idempotencyKey is required and must not exceed 191 characters/)
    assert.match(idempotency, /uid\.toLowerCase\(\) === '@all'/)

    for (const routePath of [
      'server/api/v1/console/notifications/actionable-lifecycle.post.ts',
      'server/api/v1/console/notifications/integration-operation-dead-letter.post.ts'
    ]) {
      const route = source(routePath)
      assertBefore(route, 'assertNotificationPublisherIdentity(', 'readBody(event)')
      assert.match(route, /resolveConsoleRuntimeBinding\(event\)/)
    }
  })

  test('notification read and archive APIs bind recipient to the current user', () => {
    const readRoute = source('server/api/v1/console/notifications/[notificationId]/read.post.ts')
    const archiveRoute = source('server/api/v1/console/notifications/[notificationId]/archive.post.ts')
    const readAllRoute = source('server/api/v1/console/notifications/read-all.post.ts')
    const notifications = source('server/utils/notifications.ts')
    const runtimeNotifications = source('../data-runtime/internal/apps/console/notifications.go')

    assertBefore(readRoute, 'requireNotificationUserUid(event)', 'getRouterParam(event, \'notificationId\')')
    assertBefore(readRoute, 'requireNotificationUserUid(event)', 'mutateConsoleUserNotification(event')
    assert.match(readRoute, /requireIdempotencyKey\(event\)/)
    assert.doesNotMatch(readRoute, /readBody|uid:\s*body|body\?\.uid/)

    assertBefore(archiveRoute, 'requireNotificationUserUid(event)', 'getRouterParam(event, \'notificationId\')')
    assertBefore(archiveRoute, 'requireNotificationUserUid(event)', 'mutateConsoleUserNotification(event')
    assert.match(archiveRoute, /requireIdempotencyKey\(event\)/)
    assert.doesNotMatch(archiveRoute, /readBody|uid:\s*body|body\?\.uid/)

    assertBefore(readAllRoute, 'requireNotificationUserUid(event)', 'readBody(event)')
    assertBefore(readAllRoute, 'requireNotificationUserUid(event)', 'markAllConsoleUserNotificationsRead(event')
    assert.match(readAllRoute, /requireIdempotencyKey\(event\)/)
    assert.doesNotMatch(readAllRoute, /uid:\s*body|body\?\.uid/)

    assert.match(notifications, /authContext\?\.authenticated && authContext\.subjectType !== 'service'/)
    assert.match(notifications, /authContext\?\.tokenUse !== 'service' && authContext\?\.subjectType !== 'service'/)
    assert.match(runtimeNotifications, /WHERE uid=\? AND notification_id=\?/)
    assert.match(runtimeNotifications, /filters := \[\]string\{\s*"r\.uid=\?"/)
    assert.match(runtimeNotifications, /trusted_notification_user_required/)
  })

  test('Foundation notification compatibility routes do not accept client supplied recipient uid', () => {
    const readRoute = source('../foundation/server/api/notifications/[notificationId]/read.post.ts')
    const archiveRoute = source('../foundation/server/api/notifications/[notificationId]/archive.post.ts')
    const readAllRoute = source('../foundation/server/api/notifications/read-all.post.ts')
    const proxy = source('../foundation/server/utils/notifications.ts')

    for (const content of [readRoute, archiveRoute]) {
      assert.match(content, /fetchConsoleNotificationsForUser\(event,/)
      assert.doesNotMatch(content, /readBody|uid|recipient/)
      assertBefore(content, 'requireConsoleNotificationsUserCredentials(event)', 'getRouterParam(event, \'notificationId\')')
      assertBefore(content, 'getRouterParam(event, \'notificationId\')', 'fetchConsoleNotificationsForUser(event')
    }

    assert.match(readAllRoute, /fetchConsoleNotificationsForUser\(event,\s*'\/api\/v1\/console\/notifications\/read-all'/)
    assert.doesNotMatch(readAllRoute, /uid:\s*body|body\?\.uid|recipient/)
    assertBefore(readAllRoute, 'requireConsoleNotificationsUserCredentials(event)', 'readBody(event)')
    assertBefore(readAllRoute, 'readBody(event)', 'fetchConsoleNotificationsForUser(event')

    assert.match(proxy, /export function requireConsoleNotificationsUserCredentials/)
    assert.match(proxy, /export async function fetchConsoleNotificationsForUser/)
    assert.match(proxy, /notificationUserForwardHeaders\(event\)/)
    assert.match(proxy, /auth\?\.authenticated || auth\.subjectType !== 'user' || auth\.tokenUse === 'service'/)
    assert.doesNotMatch(proxy, /x-hzy-actor-uid|x-user-uid/)
  })

  test('service actor helper enforces exact audience, token_use and scope', () => {
    const content = source('server/utils/vault.ts')
    const authorization = source('server/utils/consoleServiceActor.ts')
    const helperBlock = content.slice(
      content.indexOf('export async function requireConsoleServiceActor'),
      content.indexOf('export async function requireVaultServiceActor')
    )

    assert.match(helperBlock, /audience/)
    assert.match(authorization, /claims\.token_use !== 'service'/)
    assert.match(authorization, /scopes\.includes\(input\.requiredScope\)/)
    assert.match(authorization, /insufficient_scope/)
  })

  test('admin-triggered WeCom test notification still requires integration edit access', () => {
    const content = source('server/api/v1/console/notification-runtime/wecom-test.post.ts')
    const handlerBlock = content.slice(content.indexOf('export default defineEventHandler'))

    assertBefore(
      handlerBlock,
      'requireIntegrationAccess(event, \'edit\')',
      'sendWecomIntegrationTestMessage'
    )
    assertBefore(
      handlerBlock,
      'requireIntegrationAccess(event, \'edit\')',
      'tryPublishWecomTestResultNotification'
    )
  })

  test('WeCom test uses Console-bound runtime identity and never sends directly', () => {
    const integrations = source('server/utils/integrations.ts')
    const issuerStart = integrations.indexOf('async function issueNotificationDeliveryToken')
    const issuerEnd = integrations.indexOf('\nfunction responseMessage', issuerStart)
    const issuerBlock = integrations.slice(issuerStart, issuerEnd)
    const start = integrations.indexOf('async function sendIntegrationTestMessage')
    const end = integrations.indexOf('\nexport async function sendWecomIntegrationTestMessage', start + 1)
    const block = integrations.slice(start, end < 0 ? undefined : end)

    assert.match(issuerBlock, /requestServiceAccessToken\(\{/)
    assert.match(issuerBlock, /audience:\s*target\.audience/)
    assert.match(issuerBlock, /scope:\s*target\.scope/)
    assert.doesNotMatch(issuerBlock, /loadNotificationRuntimeServiceClient|issueServiceAccessToken/)
    assert.match(block, /sourceAppCode:\s*'console'/)
    assert.match(block, /url:\s*notificationTestActionUrl\(input\.event\)/)
    assert.match(block, /provider === 'wecom'[\s\S]*`console:notification-runtime:wecom-test:\$\{requestKey\}`/)
    assert.match(block, /idempotencyKey\s*\n/)
    assert.match(block, /if \(!target\.runtimeUrl\)[\s\S]*notification-runtime is not configured/)
    assert.doesNotMatch(block, /message\/send|direct_wecom|resolveVaultSecret|requestWecomAccessToken/)
    assert.match(integrations, /sendWecomIntegrationTestMessage[\s\S]*sendIntegrationTestMessage\(input, 'wecom'\)/)

    const route = source('server/api/v1/console/notification-runtime/wecom-test.post.ts')
    const page = source('app/pages/connector-runtime.vue')
    assert.match(route, /requestKey = stringValue\(body\.requestKey\)/)
    assert.match(route, /wecomTestResultIdempotencyKey\(\{/)
    assert.match(route, /actorId:\s*recipientUid/)
    assert.match(route, /integrationCode:\s*input\.integrationCode/)
    assert.match(route, /touser:\s*input\.touser/)
    assert.match(route, /requestKey:\s*input\.requestKey/)
    assert.match(route, /status:\s*input\.status/)
    assert.match(route, /authorizationDescriptor:\s*\{[\s\S]*resource:\s*'notification_runtime'[\s\S]*id:\s*input\.integrationCode/)
    assert.match(route, /createHash\('sha256'\)/)
    assert.match(route, /const replay = await sendWecomIntegrationTestMessage\(\{[\s\S]*requestKey[\s\S]*isConfirmedRuntimeReplay\(replay\)/)
    assert.match(route, /测试消息已发送，但 Enterprise Connector Runtime 未返回已确认的幂等重放证据/)
    assert.match(route, /actionUrl:\s*null/)
    assert.match(page, /企业微信测试消息已发送/)
    assert.match(page, /发送记录已保存到消息中心/)
    assert.doesNotMatch(page, /幂等重放已验证/)
    assert.match(page, /requestKey:\s*globalThis\.crypto\.randomUUID\(\)/)

    assert.match(integrations, /resolveTenantGatewayServiceAppBaseUrl\(event, 'console', \{ basePath: '\/' \}\)/)
    assert.match(integrations, /if \(trustedTenantBaseUrl\)[\s\S]*new URL\('\/notifications', trustedTenantBaseUrl\)/)
    assert.match(integrations, /getHeader\(event, 'x-hzy-gateway'\)[\s\S]*Trusted tenant gateway URL is required for notification links/)
    assert.match(integrations, /new URL\('\/notifications', getRequestURL\(event\)\.origin\)/)
    assertBefore(
      integrations,
      'Trusted tenant gateway URL is required for notification links',
      'new URL(\'/notifications\', getRequestURL(event).origin)'
    )
  })

  test('active notification delivery target configuration check validates JWT without delivering a message', () => {
    const integrations = source('server/utils/integrations.ts')
    const probeStart = integrations.indexOf('async function probeNotificationRuntimeAuthorization')
    const probeEnd = integrations.indexOf('\nfunction mapNotificationRuntimeSendError', probeStart)
    const probeBlock = integrations.slice(probeStart, probeEnd)
    const checkStart = integrations.indexOf('export async function checkWecomNotificationRuntimeConfig')
    const checkBlock = integrations.slice(checkStart)

    assert.match(probeBlock, /issueNotificationDeliveryToken\(event, target\)/)
    assert.match(probeBlock, /target\.runtimeUrl/)
    assert.match(probeBlock, /\/v1\/notifications\/send/)
    assert.match(probeBlock, /body:\s*\{\}/)
    assert.match(probeBlock, /notificationRuntimeStatusCode\(error\) === 400/)
    assert.match(probeBlock, /\['invalid_touser', 'invalid_message'\]\.includes\(errorCode\)/)
    assert.doesNotMatch(probeBlock, /touser\s*:|integrationCode\s*:|idempotencyKey\s*:/)
    assert.match(checkBlock, /const target = await resolveNotificationDeliveryTarget\(\)/)
    assert.match(checkBlock, /probeNotificationRuntimeAuthorization\(input\.event, target\)/)
    assert.match(checkBlock, /deliveryMode: target\.deliveryMode/)
    assert.match(checkBlock, /'runtimeAuthorization'/)
    assert.match(checkBlock, /'Runtime JWT 认证'/)
  })

  test('notification runtime issuer failures become actionable configuration errors', () => {
    const integrations = source('server/utils/integrations.ts')
    const mapperStart = integrations.indexOf('function mapNotificationRuntimeSendError')
    const mapperEnd = integrations.indexOf('\ntype ConfigCheckStatus', mapperStart)
    const mapperBlock = integrations.slice(mapperStart, mapperEnd)

    assert.match(mapperBlock, /notificationRuntimeErrorCode\(error\) === 'invalid_jwt'/)
    assert.match(mapperBlock, /invalid issuer/i)
    assert.match(mapperBlock, /statusCode:\s*409/)
    assert.match(mapperBlock, /HZY_NOTIFICATION_RUNTIME_JWT_ISSUER/)
    assert.match(mapperBlock, /getOidcIssuer\(event\)/)
    assert.match(mapperBlock, /notificationRuntimeErrorCode\(error\) === 'console_request_failed'/)
    assert.match(mapperBlock, /service integration identity is incomplete/i)
    assert.match(mapperBlock, /服务身份缺少 appCode/)
  })

  test('notification configuration check delegates credential validation to tenant runtime', () => {
    const integrations = source('server/utils/integrations.ts')
    const checkStart = integrations.indexOf('export async function checkWecomNotificationRuntimeConfig')
    const checkBlock = integrations.slice(checkStart)

    assert.match(checkBlock, /await checkIntegration\(/)
    assert.match(checkBlock, /'客户侧凭证与接口检测'/)
    assert.match(checkBlock, /Tenant Runtime 检测通过/)
    assert.doesNotMatch(checkBlock, /service_clients|service_client_grants|resolveVaultSecret/)
    assert.doesNotMatch(checkBlock, /secretCode|secretVersionNo/)
  })

  test('notification runtime grants explicitly allow the managed WeCom integration', () => {
    const authorization = source('server/utils/notificationRuntimeAuthorization.ts')
    const runtime = source('../data-runtime/internal/apps/console/integrations.go')

    assert.match(authorization, /NOTIFICATION_RUNTIME_DEFAULT_INTEGRATION_CODE = 'wecom\.default'/)
    assert.match(authorization, /integrationCodes:\s*\[NOTIFICATION_RUNTIME_DEFAULT_INTEGRATION_CODE\]/)
    assert.match(authorization, /usageTypes:\s*\['integration'\]/)
    assert.match(runtime, /service_client_grants/)
    assert.match(runtime, /integrationCodes/)
    assert.match(runtime, /"credential_vault", "resolve"/)
  })

  test('legacy notification runtime install APIs are permission-gated and permanently retired', () => {
    const getRoute = source('server/api/v1/console/notification-runtime/install-command.get.ts')
    const postRoute = source('server/api/v1/console/notification-runtime/install-command.post.ts')

    assert.match(getRoute, /requireSystemSettingsAccess\(event, 'view'\)[\s\S]*statusCode: 410/)
    assert.match(postRoute, /requireSystemSettingsAccess\(event, 'admin'\)[\s\S]*statusCode: 410/)
    assert.doesNotMatch(`${getRoute}\n${postRoute}`, /notificationRuntimeInstall|readBody|clientSecret/)
  })

  test('legacy notification runtime page redirects to the connector runtime page', () => {
    const content = source('app/pages/notification-runtime.vue')

    assert.match(content, /navigateTo\('\/connector-runtime', \{ redirectCode: 301 \}\)/)
    assert.doesNotMatch(content, /notification\.runtimeApiUrl|wecom-test/)
  })
})
