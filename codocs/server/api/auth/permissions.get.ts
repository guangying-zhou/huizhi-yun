import { appCode, resources as manifestResources } from '~~/app/config/permissions'
import { getRequestUid } from '~~/server/utils/authIdentity'
import { loadAuthorizationSnapshotFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { setHeader } from 'h3'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
  setHeader(event, 'Pragma', 'no-cache')
  setHeader(event, 'Expires', '0')

  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const bundleSnapshot = await loadAuthorizationSnapshotFromConsoleRuntime(uid, appCode, event, {
    localDev: {
      resources: manifestResources,
      fallbackActions: ['view', 'edit', 'admin']
    }
  })
  if (bundleSnapshot) {
    return {
      code: 0,
      data: {
        uid,
        roles: bundleSnapshot.roles,
        availableRoles: bundleSnapshot.availableRoles,
        activeRoleCode: bundleSnapshot.activeRoleCode,
        resources: bundleSnapshot.resources
      }
    }
  }

  return {
    code: 0,
    data: {
      uid,
      roles: [],
      availableRoles: [],
      activeRoleCode: '',
      resources: {}
    }
  }
})
