import { setLocalServiceTokenIssuer } from '@hzy/foundation/server/utils/serviceOidc'
import { issueConsoleRuntimeServiceToken } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import { getOidcIssuer, getOidcTtl, loadOidcPolicyDigest } from '~~/server/utils/oidc'
import { isPolicyStorageToken } from '~~/server/utils/policyStorageToken'
import { coalescePolicyRead } from '~~/server/utils/persistentPolicyBundle'
import { logAuthDependencyFailure } from '@hzy/foundation/server/utils/authDependencyDiagnostic'

/**
 * Console 是 service token 的签发方（持有 OIDC signing key）。它自身调用跨模块 API
 * （如审批中心 workflow-proxy 需要 `workflow:proxy` token）时，不能像业务应用那样 HTTP
 * 请求 `/oauth/token`——Cloudflare Worker 无法 fetch 自己的路由（self-fetch 会 522）。
 *
 * 这里注册的本地适配器只调用已注册的客户 Tenant Runtime。Runtime 持有
 * console.runtime 当前凭据、active grants 与 OIDC 私钥并完成签名；Console 不读取这些表，
 * 也不接触私钥。该 bootstrap 调用必须使用 enrollment/static token 或可信 Gateway 注入。
 */
export default defineNitroPlugin(() => {
  setLocalServiceTokenIssuer(async ({ audience, scope, deploymentCodeOverride, sourceBinding, event }) => {
    if (!event) return null

    // This adapter only merges pending work within an event. Foundation's
    // caller also has a context-isolated, expiry-bounded token cache/flight;
    // this local guard prevents duplicate work if the adapter is called again
    // from the same event before that shared layer resolves.
    const key = JSON.stringify(['local-service-token', audience, scope, deploymentCodeOverride || null, sourceBinding || 'trusted-gateway'])
    return coalescePolicyRead(event, key, async () => {
      const issuedScope = deploymentCodeOverride
        && audience === 'data-runtime'
        && scope === 'data-runtime:runtime:update'
        ? 'runtime.update'
        : scope
      const policyStartedAt = Date.now()
      let policy
      try {
        policy = isPolicyStorageToken(audience, scope)
          ? { policyVersion: null, caps: null }
          : await loadOidcPolicyDigest(event)
      } catch (error) {
        logAuthDependencyFailure(event, 'service-token-local-policy', error, Date.now() - policyStartedAt)
        throw error
      }
      const issueStartedAt = Date.now()
      let response
      try {
        response = await issueConsoleRuntimeServiceToken(event, {
          audience,
          scope,
          issuedScope,
          issuer: getOidcIssuer(event),
          ttlSeconds: getOidcTtl(event, 'accessTokenTtlSeconds'),
          deploymentCodeOverride,
          sourceBinding,
          policyVersion: policy.policyVersion,
          caps: policy.caps
        })
      } catch (error) {
        logAuthDependencyFailure(event, 'service-token-local-runtime', error, Date.now() - issueStartedAt)
        throw error
      }
      return response.data.accessToken
    })
  })
})
