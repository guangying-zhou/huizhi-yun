import { setLocalServiceTokenIssuer } from '@hzy/foundation/server/utils/serviceOidc'
import { issueServiceAccessToken } from '~~/server/utils/oidc'

/**
 * Console 是 service token 的签发方（持有 OIDC signing key）。它自身调用跨模块 API
 * （如审批中心 workflow-proxy 需要 `workflow:proxy` token）时，不能像业务应用那样 HTTP
 * 请求 `/oauth/token`——Cloudflare Worker 无法 fetch 自己的路由（self-fetch 会 522）。
 *
 * 这里注册一个本地签发器：在 worker 内部用 Console 自己的 signing key 直接签发。Console
 * 作为 token authority，给自身签发所需的 service token 是其固有能力，不需要再走
 * service_client_grants（grant 是约束非签发方的业务应用的）。业务应用不注册本签发器，
 * 仍走正常的 HTTP client_credentials 流程。
 */
export default defineNitroPlugin(() => {
  setLocalServiceTokenIssuer(async ({ audience, scope, event }) => {
    if (!event) return null

    const token = await issueServiceAccessToken({
      event,
      audience,
      scope,
      serviceClient: {
        clientId: 'console.runtime',
        clientCode: 'console.runtime',
        clientName: 'Console Runtime',
        clientType: 'runtime',
        appCode: 'console',
        credentialId: 0
      }
    })

    return token.accessToken
  })
})
