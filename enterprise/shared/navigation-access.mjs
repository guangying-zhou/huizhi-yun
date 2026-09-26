// Navigation is discovery only. Business handlers remain the authority for
// object/field scope and every read or mutation.
export function navigationLeaves(navigation, workspaces) {
  return [
    ...[...navigation.primary, ...navigation.auxiliary].flatMap(area => area.children.flatMap(group => group.children)),
    ...workspaces.flatMap(workspace => [...workspace.groups.flatMap(group => group.items), ...(workspace.actions || [])])
  ]
}

export async function resolveNavigationAccess(items, { available, load, allows }) {
  if (!available) return []
  const modules = [...new Set(items.map(item => item.module).filter(Boolean))]
  const snapshots = new Map(await Promise.all(modules.map(async module => [module, await load(module)])))
  return items.filter(item => {
    if (!item.id || !item.module) return false
    const refs = item.permissionRefs || (item.permission ? [item.permission] : [])
    if (!refs.length) return false
    const check = permission => allows(snapshots.get(item.module), permission)
    return item.mode === 'any' ? refs.some(check) : refs.every(check)
  }).map(item => item.id)
}

export function filterNavigationAccess(navigation, allowedIds) {
  const allowed = new Set(allowedIds)
  const filter = areas => areas.flatMap(area => {
    const children = area.children.flatMap(group => {
      const children = group.children.filter(item => allowed.has(item.id))
      return children.length ? [{ ...group, children }] : []
    })
    return children.length ? [{ ...area, children }] : []
  })
  return { primary: filter(navigation.primary), auxiliary: filter(navigation.auxiliary) }
}

export function filterWorkspaceAccess(workspaces, allowedIds) {
  const allowed = new Set(allowedIds)
  return workspaces.map(workspace => ({ ...workspace, ...(workspace.actions ? { actions: workspace.actions.filter(item => allowed.has(item.id)) } : {}), groups: workspace.groups.flatMap(group => {
    const items = group.items.filter(item => allowed.has(item.id))
    return items.length ? [{ ...group, items }] : []
  }) })).filter(workspace => workspace.groups.length)
}

// Discovery-only lease, not a grant or a business authorization cache. The
// server rechecks permissions on every request and business handlers on every
// action. Measure from request start so transit time cannot extend the lease.
// Five minutes: revocation already needs a policy sync to arrive, and every
// refresh reads a Console snapshot per module, so a shorter lease buys little.
export const NAVIGATION_MAX_AGE_MS = 300_000

// Hard invalidation is synchronous; same-identity refresh retains a still-valid
// snapshot until its deadline. Neither retries nor an outage extend that lease.
export function createNavigationAccessLoader({ fetchAccess, publish, now = Date.now, schedule = setTimeout, cancel = clearTimeout }) {
  let generation = 0
  let controller
  let inFlight
  let timer
  let scope = ''
  let ids = []
  let expiresAt = 0
  function discard(status) {
    cancel(timer)
    timer = undefined
    ids = []
    expiresAt = 0
    publish(ids, status)
  }
  function clear() {
    generation++
    controller?.abort()
    inFlight = undefined
    scope = ''
    discard('idle')
  }
  async function refresh(nextScope) {
    if (!nextScope || scope !== nextScope) clear()
    if (!nextScope) return
    scope = nextScope
    // Route, focus and periodic refreshes share the same request. A slow
    // response must not be perpetually preempted by the 30-second timer.
    if (inFlight) return inFlight
    const current = ++generation
    const startedAt = now()
    controller = new AbortController()
    if (expiresAt <= startedAt) discard('loading')
    else publish(ids, 'refreshing')
    let fetched
    try { fetched = fetchAccess(controller.signal) }
    catch (error) { fetched = Promise.reject(error) }
    const request = (async () => { try {
      const result = await fetched
      if (current !== generation) return
      const ttl = Math.min(NAVIGATION_MAX_AGE_MS, Number(result.maxAgeMs))
      if (!Array.isArray(result.visibleIds) || result.visibleIds.some(id => typeof id !== 'string')
        || !Number.isFinite(ttl) || ttl <= 0 || startedAt + ttl <= now()) throw Error('Invalid or expired navigation snapshot')
      // Keep the reference when visibility is unchanged: computed workspace
      // trees and project lifecycles must not react to a status-only refresh.
      if (ids.length !== result.visibleIds.length || ids.some((id, i) => id !== result.visibleIds[i])) ids = result.visibleIds
      expiresAt = startedAt + ttl
      cancel(timer)
      timer = schedule(() => {
        // Expire only the old display lease. A newer same-scope request may
        // still restore visibility if its own start-bound lease is valid.
        if (!inFlight) {
          generation++
          controller?.abort()
          controller = undefined
        }
        discard('expired')
      }, expiresAt - now())
      timer?.unref?.()
      publish(ids, 'ready')
    } catch {
      if (current === generation) discard('error')
    } finally {
      if (inFlight === request) inFlight = undefined
      if (current === generation) controller = undefined
    } })()
    inFlight = request
    return request
  }
  return { clear, refresh }
}
