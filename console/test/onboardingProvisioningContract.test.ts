import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  onboardingCommandDigest,
  onboardingContractFor,
  parseOnboardingProvisioningCommand
} from '../server/utils/onboardingProvisioningContract.ts'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

function workspaceSource(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
}

function envelopeFor(kind: 'identity-reserve' | 'user-provision', overrides: Record<string, unknown> = {}, commandOverrides: Record<string, unknown> = {}) {
  const contract = onboardingContractFor(kind)
  const command = {
    onboardingCode: 'ONB-ABC',
    sourceApp: 'people',
    sourceBizCode: 'ONB-ABC',
    uid: 'liukai',
    providerCode: 'dingtalk',
    providerSubject: 'ding-liukai',
    objectVersion: 3,
    actorUid: 'hr001',
    originalActorUid: 'hr001',
    ...(kind === 'user-provision' ? { reservationId: 'reservation-1' } : {}),
    ...commandOverrides
  }
  return {
    serviceCommand: {
      operationId: 'op-1',
      operationCode: contract.operationCode,
      requiredCapability: contract.capability,
      idempotencyKey: 'onboarding:identity-reserve:ONB-ABC:v3',
      commandSchemaVersion: 'v1',
      commandSha256: onboardingCommandDigest(command),
      sourceApp: 'people',
      targetApp: 'console',
      sourceDeployment: 'C000001-people',
      targetDeployment: 'C000001-console',
      command,
      ...overrides
    }
  }
}

test('onboarding provisioning commands are accepted only with an intact identity and hash', () => {
  const parsed = parseOnboardingProvisioningCommand(envelopeFor('identity-reserve'), 'identity-reserve')
  assert.equal(parsed.uid, 'liukai')
  assert.equal(parsed.onboardingCode, 'ONB-ABC')

  // 篡改 command 而不更新哈希：同一幂等键对应两份不同业务意图，必须 409。
  const tampered = envelopeFor('identity-reserve')
  ;(tampered.serviceCommand.command as Record<string, unknown>).uid = 'someone-else'
  assert.throws(() => parseOnboardingProvisioningCommand(tampered, 'identity-reserve'), /409|invalid/i)

  // 错来源应用、错目标应用、错 capability、错 operation code 都必须拒绝。
  for (const override of [
    { sourceApp: 'altoc' },
    { targetApp: 'platform' },
    { requiredCapability: 'console:directory-employment:sync' },
    { operationCode: 'people.directory.employment-sync.v1' },
    { commandSchemaVersion: 'v2' },
    { sourceDeployment: '' },
    { targetDeployment: '' },
    { idempotencyKey: '' },
    { operationId: '' }
  ]) {
    assert.throws(
      () => parseOnboardingProvisioningCommand(envelopeFor('identity-reserve', override), 'identity-reserve'),
      /409|invalid/i,
      `override ${JSON.stringify(override)} must be rejected`
    )
  }

  // 用预留的信封调开户端点必须失败：两个 capability 互不蕴含。
  assert.throws(() => parseOnboardingProvisioningCommand(envelopeFor('identity-reserve'), 'user-provision'), /409|invalid/i)
})

test('provisioning refuses synthetic dt-* subjects on the target side', () => {
  // 不依赖调用方自律：目标侧独立拒绝。
  assert.throws(
    () => parseOnboardingProvisioningCommand(
      envelopeFor('user-provision', {}, { uid: 'dt-0123456789abcdef' }),
      'user-provision'
    ),
    /synthetic/i
  )
})

test('provisioning commands require an onboarding case and a positive object version', () => {
  for (const commandOverride of [
    { onboardingCode: '' },
    { sourceApp: '' },
    { sourceApp: 'altoc' },
    { sourceBizCode: '' },
    { sourceBizCode: 'ONB-OTHER' },
    { providerCode: '' },
    { providerCode: 'wecom' },
    { providerSubject: '' },
    { uid: '' },
    { objectVersion: 0 },
    { objectVersion: -1 }
  ]) {
    assert.throws(
      () => parseOnboardingProvisioningCommand(envelopeFor('identity-reserve', {}, commandOverride), 'identity-reserve'),
      /409|invalid/i,
      `command override ${JSON.stringify(commandOverride)} must be rejected`
    )
  }
})

test('onboarding service endpoints enforce capability, signature binding and credential containment', () => {
  const reserve = source('server/api/v1/console/service/directory/onboarding/identity-reservations.post.ts')
  const provision = source('server/api/v1/console/service/directory/onboarding/user-provision.post.ts')
  const activation = source('server/api/v1/console/service/directory/onboarding/activation-link.post.ts')
  const seed = source('docs/sql/Console-SQL-Seed-v2.4-people-onboarding-provisioning-grants.sql')
  const caller = workspaceSource('people/server/utils/onboardingProvisioning.ts')

  // 每个端点各自校验精确 capability，并绑定 target app。
  assert.match(reserve, /requireConsoleServiceActor\(event, 'console', 'console:directory-identity:reserve', \{\s*requireBoundTargetApp: true/)
  assert.match(provision, /requireConsoleServiceActor\(event, 'console', 'console:directory-user:provision', \{\s*requireBoundTargetApp: true/)
  for (const route of [reserve, provision]) {
    assert.match(route, /verifyPeopleDirectorySignature/)
    assert.match(route, /resolvePeopleDirectoryTargetBinding/)
    assert.match(route, /parseOnboardingProvisioningCommand/)
  }

  // 开户阶段不得提前签发激活凭据；只有 LDAP 成功后的独立端点可签发，且
  // People 与站内通知都不能接收或持久化明文令牌 URL。
  assert.doesNotMatch(provision, /activationToken/)
  assert.match(provision, /issueActivationCredential:\s*false/)
  assert.doesNotMatch(provision, /initialPassword/)
  assert.match(activation, /issueConsoleDirectoryActivationCredentialForServiceCommand/)
  assert.match(activation, /channel: 'dingtalk'/)
  assert.match(activation, /externalRecipients: String\(command\.providerSubject/)
  assert.match(activation, /inAppUrl: `\$\{base\}\/set-password`/)
  assert.match(activation, /directory:activation:\$\{uid\}:\$\{credentialId\}/)
  assert.doesNotMatch(activation, /data:\s*\{[^}]*activationToken/s)
  assert.doesNotMatch(activation, /console\.error\([^)]*\{\s*uid,\s*error/s)

  // 两个 capability 各有独立 grant；宽 scope 不得替代。
  assert.match(seed, /'console:directory-identity' resource_code,'reserve' action/)
  assert.match(seed, /'console:directory-user','provision'/)
  // 在线归并在全应用引用核查产品化前必须 fail-closed；仍先验证精确 capability。
  const mergeRoute = source('server/api/v1/console/service/directory/subject-merge.post.ts')
  assert.match(mergeRoute, /'console:directory-user:provision'/)
  assert.match(mergeRoute, /statusCode: 410/)
  assert.doesNotMatch(mergeRoute, /mergeConsoleDirectorySubject/)
  assert.doesNotMatch(mergeRoute, /directory_users:edit/)

  // 调用方以入职单编码加版本派生幂等键，重试不产生第二次预留或第二个账号。
  assert.match(caller, /onboarding:\$\{input\.kind\}:\$\{onboardingCode\}:v\$\{input\.objectVersion\}/)
  assert.match(caller, /x-hzy-service-command-signature/)
  assert.match(caller, /originalActorUid: actorUid/)
  assert.match(caller, /actorUid,/)
  assert.match(caller, /sourceApp: 'people'/)
  assert.match(caller, /sourceBizCode: onboardingCode/)
})
