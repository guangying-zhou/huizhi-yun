import { defineEventHandler, setHeader } from 'h3'
import { requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadScopedAuthorizationFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { assetsObjectScopeFromScopedAuthorization } from '../../../../../../assets/server/utils/assetsScopedAuthorizationCore'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  const user = await requireEnterpriseUser(event)
  const resources = ['digital_assets', 'ip_assets'] as const
  const access = await Promise.all([
    ...resources.map(async (resourceCode) => {
      const snapshot = await loadScopedAuthorizationFromConsoleRuntime(event, user.uid, 'assets', { resourceCode, action: 'edit' })
      return assetsObjectScopeFromScopedAuthorization(snapshot, resourceCode, 'edit').access !== 'none'
    }),
    (async () => {
      const snapshot = await loadScopedAuthorizationFromConsoleRuntime(event, user.uid, 'assets', { resourceCode: 'products', action: 'view' })
      return assetsObjectScopeFromScopedAuthorization(snapshot, 'products', 'view').access !== 'none'
    })()
  ])
  return { code: 0, data: { digital_assets: access[0], ip_assets: access[1], ip_assets_link_product: access[1] && access[2] } }
})
