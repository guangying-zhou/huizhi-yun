import { enterpriseNavigation } from '../utils/enterprise-navigation'
import { numericProjectId, projectReturnTarget, safeProjectReturn } from '../utils/object-navigation.mjs'

// Persist the allowed source in the actual URL, so refresh/new tabs/back/forward
// do not depend on a global last-project cache or expose sensitive draft data.
export default defineNuxtRouteMiddleware((to, from) => {
  const workspace = enterpriseNavigation.objectWorkspaces.find(item => item.code === 'aims-project')
  if (!workspace || !numericProjectId(to, workspace)) return
  const registered = enterpriseNavigation.registeredPages
  const explicit = safeProjectReturn(to.query.returnTo, registered) || safeProjectReturn(to.query.from, registered)
  const source = explicit || safeProjectReturn(from.fullPath, registered)
    || (numericProjectId(from, workspace) ? projectReturnTarget(from.query, registered) : '')
  if (source && to.query.returnTo !== source) {
    return navigateTo({ path: to.path, query: { ...to.query, returnTo: source }, hash: to.hash }, { replace: true })
  }
})
