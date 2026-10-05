import { isConsoleRootRoute } from '../../shared/utils/notificationActionUrl.js'

// 跨应用「上次访问位置」记忆：切换应用后回到上次的页面而非首页。
//
// 设计要点：
// - 记录认地址栏真值：离开页面时读 window.location（见 plugins/app-last-route.client.ts），
//   不依赖 vue-router 事件，这样即使页签用 history API / 浅路由改 URL 也能抓到正确路径。
// - 恢复交给目标应用自己的 router（见 middleware/app-last-route.global.ts），
//   本文件只负责「存 / 取应用内相对路径」，不做任何跨应用 URL 拼接。
// - 生产同子域 localStorage 互通；本地多端口或不可用环境自动失效（读写返回空，调用方降级）。

const STORAGE_PREFIX = 'hzy:last-route:'
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
const APP_RELATIVE_PATH_MODE = 'app-relative'

type LastRouteRecord = {
  path?: string
  ts?: number
  pathMode?: typeof APP_RELATIVE_PATH_MODE
}

// 不该被记忆为「上次位置」的路径：登录、认证回调、错误页等。
const IGNORED_PATTERNS = [
  /^\/login(?:[/?#]|$)/,
  /^\/logout(?:[/?#]|$)/,
  /^\/auth(?:[/?#]|$)/,
  /^\/oauth(?:[/?#]|$)/,
  /^\/sso(?:[/?#]|$)/,
  /^\/callback(?:[/?#]|$)/,
  /^\/embed(?:[/?#]|$)/,
  /^\/no-access(?:[/?#]|$)/,
  /^\/error(?:[/?#]|$)/
]

const CONSOLE_WORKSPACE_ROUTE_PREFIXES = [
  '/profile',
  '/settings/profile',
  '/todos',
  '/approval',
  '/notifications'
]

function storageKey(appCode: string) {
  return `${STORAGE_PREFIX}${appCode}`
}

function isIgnoredPath(path: string) {
  return IGNORED_PATTERNS.some(pattern => pattern.test(path))
}

function normalizeBaseURL(value: string | null | undefined) {
  const normalized = String(value || '/').trim()
  if (!normalized || normalized === '/') return '/'
  const withLeading = normalized.startsWith('/') ? normalized : `/${normalized}`
  return withLeading.endsWith('/') ? withLeading : `${withLeading}/`
}

// 从地址栏当前 URL 推出「应用内相对路径」（去掉 baseURL，保留 query/hash）。
// 只读 window.location，是与页签实现方式无关的真值来源。
export function currentAppRelativePath(baseURL: string | null | undefined): string {
  if (!import.meta.client) return '/'
  const base = normalizeBaseURL(baseURL)
  let pathname = window.location.pathname || '/'

  if (base !== '/') {
    const baseNoTrailing = base.replace(/\/+$/, '')
    if (pathname === baseNoTrailing || pathname === base) {
      pathname = '/'
    } else if (pathname.startsWith(base)) {
      pathname = `/${pathname.slice(base.length)}`
    } else if (pathname.startsWith(`${baseNoTrailing}/`)) {
      pathname = pathname.slice(baseNoTrailing.length)
    }
  }

  pathname = `/${pathname.replace(/^\/+/, '')}`
  return `${pathname}${window.location.search}${window.location.hash}`
}

export function saveLastRoute(appCode: string, path: string) {
  if (!import.meta.client) return
  const code = String(appCode || '').trim()
  const normalized = stripApplicationShellEmbedParam(path, window.location.origin)
  if (!code || !normalized || isIgnoredPath(normalized)) return
  if (normalized === '/') {
    clearLastRoute(code)
    return
  }

  try {
    localStorage.setItem(storageKey(code), JSON.stringify({
      path: normalized,
      ts: Date.now(),
      pathMode: APP_RELATIVE_PATH_MODE
    }))
  } catch {
    // localStorage 不可用（隐私模式/配额）时静默放弃记忆。
  }
}

function readLastRouteRecord(appCode: string): LastRouteRecord | null {
  if (!import.meta.client) return null
  const code = String(appCode || '').trim()
  if (!code) return null

  try {
    const raw = localStorage.getItem(storageKey(code))
    if (!raw) return null
    const record = JSON.parse(raw) as LastRouteRecord
    const path = String(record?.path || '').trim()
    const ts = Number(record?.ts)
    if (!path || path === '/' || isIgnoredPath(path)) return null
    if (!Number.isFinite(ts) || Date.now() - ts > MAX_AGE_MS) return null
    return {
      path,
      ts,
      ...(record.pathMode === APP_RELATIVE_PATH_MODE
        ? { pathMode: APP_RELATIVE_PATH_MODE }
        : {})
    }
  } catch {
    return null
  }
}

export function readLastRoute(appCode: string): string | null {
  return readLastRouteRecord(appCode)?.path || null
}

export function clearLastRoute(appCode: string) {
  if (!import.meta.client) return
  const code = String(appCode || '').trim()
  if (!code) return

  try {
    localStorage.removeItem(storageKey(code))
  } catch {
    // localStorage 不可用时无需阻断应用启动。
  }
}

function pathnameWithSuffix(url: URL) {
  return `${url.pathname}${url.search}${url.hash}`
}

function stripRepeatedHomePathPrefix(savedPathname: string, homePathname: string) {
  if (homePathname === '/') return savedPathname

  let pathname = savedPathname
  const repeatedPrefix = `${homePathname}${homePathname}`
  while (pathname === repeatedPrefix || pathname.startsWith(`${repeatedPrefix}/`)) {
    pathname = `${homePathname}${pathname.slice(repeatedPrefix.length)}`
  }
  return pathname
}

function normalizeEntryBasePath(value: string | null | undefined) {
  const normalized = String(value || '').trim()
  if (!normalized) return ''
  if (normalized === '/') return '/'
  if (!normalized.startsWith('/') || normalized.includes('://') || normalized.includes('?') || normalized.includes('#')) {
    return ''
  }
  return normalized.replace(/\/+$/, '') || '/'
}

function isConsoleWorkspaceRoute(pathname: string, appCode: string | null | undefined) {
  if (appCode !== 'console') return false
  return CONSOLE_WORKSPACE_ROUTE_PREFIXES.some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`))
}

function pathnameWithinBase(pathname: string, basePathname: string) {
  if (basePathname === '/') return pathname
  return pathname === basePathname || pathname.startsWith(`${basePathname}/`)
    ? pathname
    : `${basePathname}/${pathname.replace(/^\/+/, '')}`.replace(/\/{2,}/g, '/')
}

function appRelativePathnameWithinBase(pathname: string, basePathname: string) {
  if (basePathname === '/') return pathname
  return `${basePathname}/${pathname.replace(/^\/+/, '')}`.replace(/\/{2,}/g, '/')
}

function isIgnoredEntryPath(pathname: string, basePathname: string) {
  if (isIgnoredPath(pathname)) return true
  if (basePathname === '/' || !pathname.startsWith(`${basePathname}/`)) return false
  return isIgnoredPath(`/${pathname.slice(basePathname.length).replace(/^\/+/, '')}`)
}

function stripConsoleHomePrefixFromRootRoute(
  pathname: string,
  homePathname: string,
  basePathname: string,
  appCode: string | null | undefined
) {
  if (appCode !== 'console' || basePathname !== '/' || homePathname !== '/admin') return pathname
  if (!pathname.startsWith(`${homePathname}/`)) return pathname

  const withoutHome = `/${pathname.slice(homePathname.length).replace(/^\/+/, '')}`
  return isConsoleRootRoute(withoutHome)
    ? withoutHome
    : pathname
}

export function resolveAppEntryUrlForSaved(
  homeUrl: string | null | undefined,
  savedPath: string | null | undefined,
  origin: string,
  basePath?: string | null,
  appCode?: string | null,
  savedPathMode?: typeof APP_RELATIVE_PATH_MODE
): string {
  const home = String(homeUrl || '').trim()
  const saved = String(savedPath || '').trim()
  if (!home || !saved) return home

  try {
    const homeUrlObject = new URL(home, origin)
    const homePathname = homeUrlObject.pathname.replace(/\/+$/, '') || '/'
    const entryBasePathname = normalizeEntryBasePath(basePath) || homePathname
    const savedUrl = new URL(saved, origin)
    if (homePathname === '/admin' && isConsoleWorkspaceRoute(savedUrl.pathname, appCode)) {
      return home
    }
    const normalizedSavedPathname = savedPathMode === APP_RELATIVE_PATH_MODE
      ? savedUrl.pathname
      : stripConsoleHomePrefixFromRootRoute(
          stripRepeatedHomePathPrefix(savedUrl.pathname, homePathname),
          homePathname,
          entryBasePathname,
          appCode
        )

    if (isIgnoredEntryPath(normalizedSavedPathname, entryBasePathname)) {
      return home
    }

    if (
      savedPathMode !== APP_RELATIVE_PATH_MODE
      && (normalizedSavedPathname.replace(/\/+$/, '') || '/') === homePathname
    ) {
      return home
    }

    const targetPathname = savedPathMode === APP_RELATIVE_PATH_MODE
      ? appRelativePathnameWithinBase(normalizedSavedPathname, entryBasePathname)
      : pathnameWithinBase(normalizedSavedPathname, entryBasePathname)
    return new URL(
      pathnameWithSuffix(new URL(`${targetPathname}${savedUrl.search}${savedUrl.hash}`, origin)),
      origin
    ).toString()
  } catch {
    return home
  }
}

// 源端深链：点击切换时把目标 URL 直接拼成「上次位置」的深链，让浏览器整页导航就落到
// 最终页，目标应用服务端一次性渲染目标页 —— 没有首页、没有二次跳转，零闪烁。
// 拼接交给浏览器原生 URL 解析：保证 homeUrl 带尾斜杠，saved 去掉前导斜杠按相对路径拼上去。
// 无记忆 / 服务端 / 解析失败一律回退 homeUrl（首页）。
export function resolveAppEntryUrl(homeUrl: string | null | undefined, appCode: string, basePath?: string | null): string {
  const home = String(homeUrl || '').trim()
  if (!home || !import.meta.client) return home

  const saved = readLastRouteRecord(appCode)
  if (!saved?.path) return home

  // 旧记录没有声明路径语义，无法区分“应用内 /assets/...”和“已含部署前缀 /assets/...”
  // （Assets 两者恰好同名）。先进入应用首页，交给目标应用 router 按应用内路径恢复；
  // 新记录带 pathMode，可由源应用安全地直接生成深链。
  if (saved.pathMode !== APP_RELATIVE_PATH_MODE) return home

  return resolveAppEntryUrlForSaved(
    home,
    saved.path,
    window.location.origin,
    basePath,
    appCode,
    saved.pathMode
  )
}

export function shouldRestoreLastRouteOnLanding(
  appCode: string | null | undefined,
  toFullPath: string,
  fromMatchedCount: number
) {
  const code = String(appCode || '').trim()
  if (!code || toFullPath !== '/' || fromMatchedCount > 0) return false

  // In Console, "/" is the workspace portal. The Console app entry is "/admin",
  // so restoring console's last admin route from "/" hijacks the workspace menu.
  if (code === 'console') return false

  return true
}
