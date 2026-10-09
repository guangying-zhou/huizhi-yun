import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { legacyAuthModeIsEnabled } from '../server/utils/authIdentity.ts'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

describe('Codocs legacy authentication route guard', () => {
  test('is disabled by default and only permits the established explicit legacy modes', () => {
    assert.equal(legacyAuthModeIsEnabled('', ''), false)
    assert.equal(legacyAuthModeIsEnabled(undefined, undefined), false)
    assert.equal(legacyAuthModeIsEnabled('oidc', 'false'), false)
    assert.equal(legacyAuthModeIsEnabled('legacy', ''), true)
    assert.equal(legacyAuthModeIsEnabled('', 'true'), true)
  })

  test('direct WeCom callback rejects before reading its code, contacting WeCom, or setting cookies', () => {
    const callback = source('server/api/auth/wecom-callback.get.ts')
    const guard = callback.indexOf('if (!isLegacyAuthEnabled(event))')
    const query = callback.indexOf('const q = getQuery(event)')
    const wecom = callback.indexOf('await getWecomUserByCode(code)')
    const cookie = callback.indexOf('setCookie(event, \'token\'')

    assert.notEqual(guard, -1)
    assert.ok(guard < query)
    assert.ok(guard < wecom)
    assert.ok(guard < cookie)
    assert.match(callback, /statusCode: 410/)
    assert.match(callback, /Use Console OIDC login/)
  })

  test('direct WeCom login rejects before reading query input, resolving the integration, or redirecting', () => {
    const login = source('server/api/auth/wecom-login.get.ts')
    const guard = login.indexOf('if (!isLegacyAuthEnabled(event))')

    assert.notEqual(guard, -1)
    assert.match(login, /statusCode:\s*410/)
    assert.match(login, /Use Console OIDC login/)

    for (const legacyEffect of [
      'const query = getQuery(event)',
      'await getWecomOAuthIntegrationConfig()',
      'return sendRedirect(event, authUrl)'
    ]) {
      const effect = login.indexOf(legacyEffect)
      assert.notEqual(effect, -1, `Missing ${legacyEffect}`)
      assert.ok(guard < effect, `The guard must precede ${legacyEffect}`)
    }
  })

  test('historical WeCom OAuth callback rejects before reading input, contacting WeCom or Directory, and setting cookies', () => {
    const callback = source('server/api/wecom/oauth.get.ts')
    const guard = callback.indexOf('if (!isLegacyAuthEnabled(event))')

    assert.notEqual(guard, -1)
    assert.match(callback, /statusCode:\s*410/)
    assert.match(callback, /Use Console OIDC login/)

    for (const legacyEffect of [
      'const query = getQuery<WecomOAuthQuery>(event)',
      'await getWecomUserByCode(code)',
      'await getUserByEmail(wecomUser.bizMail)',
      'await fetchDirectoryUser(userid)',
      'setCookie(event, \'token\''
    ]) {
      const effect = callback.indexOf(legacyEffect)
      assert.notEqual(effect, -1, `Missing ${legacyEffect}`)
      assert.ok(guard < effect, `The guard must precede ${legacyEffect}`)
    }
  })

  test('legacy Account-named directory compatibility routes require a verified session before using the Console adapter', () => {
    const sessionGuardedRoutes = [
      'server/api/account/config-check.get.ts',
      'server/api/account/department-info.get.ts',
      'server/api/account/department-members.get.ts',
      'server/api/account/departments.get.ts',
      'server/api/account/projects/[...projectCode].get.ts',
      'server/api/account/projects/index.get.ts',
      'server/api/account/users/[uid].get.ts',
      'server/api/account/users/batch.post.ts',
      'server/api/account/users/index.get.ts'
    ]

    for (const route of sessionGuardedRoutes) {
      const content = source(route)
      assert.match(content, /requireRequestUid\(event\)/, `${route} must require a verified request subject`)
      const guard = content.indexOf('requireRequestUid(event)')
      const directoryCall = content.lastIndexOf('fetchDirectory')
      assert.notEqual(guard, -1)
      assert.ok(directoryCall === -1 || guard < directoryCall, `${route} must guard before its Console directory call`)
    }
  })

  test('self-service directory compatibility routes bind requested uid to the verified session subject', () => {
    const user = source('server/api/account/user.ts')
    const departments = source('server/api/account/user-departments.get.ts')
    const projects = source('server/api/account/users/[uid]/projects.get.ts')

    assert.match(user, /requireCurrentRequestUid\(event, uid, '无权查看其他用户的目录详情'\)/)
    assert.match(departments, /const actorUid = requireCurrentRequestUid\(event, uid\)/)
    assert.match(departments, /fetchUserDepartments\(event, actorUid\)/)
    assert.match(projects, /requireCurrentRequestUid\(event, uid, '无权查看其他用户的项目关系'\)/)
  })
})
