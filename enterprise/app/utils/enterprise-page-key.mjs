export function enterprisePageKey(scope, route) {
  const query = route?.query || {}
  const path = String(route?.path || '')
  const keys = path === '/codocs/mydocs/journal'
    ? ['mode']
    : /^\/aims\/projects\/[^/]+\/requirements$/.test(path)
      ? ['tab', 'workItemId', 'batchId']
      : /^\/aims\/projects\/[^/]+\/work-items$/.test(path)
        ? ['milestone', 'create', 'id']
        : []
  // Only these registered pages read initial entry mode/deep-link state once
  // during setup. List filters and fragments are not page/object identities.
  const identity = keys.map(key => [key, query[key] ?? null])
  return JSON.stringify([String(scope || ''), path, identity])
}
