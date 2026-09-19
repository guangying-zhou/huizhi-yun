export function modulePath(module, hosted, path) {
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) throw Error('Expected a local module path')
  if (!hosted) return path
  const prefix = `/${module}`
  if (path === prefix || path.startsWith(`${prefix}/`)) return path
  if (/^\/(aims|assets)(?:\/|$)/.test(path)) throw Error('Cross-module path is not a local module path')
  return `${prefix}${path}`
}
