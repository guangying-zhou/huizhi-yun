import { getRequestURL } from 'h3'

export default defineEventHandler(async (event) => {
  const pathname = normalizeApiPath(getRequestURL(event).pathname)
  if (!pathname.startsWith('/api/webdev/')) return

  // 上报入口走 Console service token（业务应用经 Foundation 代理调用），其余走用户会话。
  if (pathname === '/api/webdev/issues/intake') {
    await requireWebDevService(event, ['webdev:issue:write', 'webdev:write'])
    return
  }
  if (pathname === '/api/webdev/issues/mine') {
    await requireWebDevService(event, ['webdev:issue:read', 'webdev:issue:write', 'webdev:read', 'webdev:write'])
    return
  }

  await requireWebDevUser(event)
})

function normalizeApiPath(pathname: string) {
  const config = useRuntimeConfig() as unknown as { public?: { appBasePath?: string } }
  const basePath = String(config.public?.appBasePath || '').replace(/\/+$/, '')
  if (basePath && basePath !== '/' && pathname.startsWith(`${basePath}/api/`)) {
    return pathname.slice(basePath.length)
  }
  return pathname
}
