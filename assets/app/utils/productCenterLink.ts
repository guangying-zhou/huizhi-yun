import { applicationShellEntryUrl } from '../../../foundation/app/utils/applicationShell'

interface Application { appCode: string, homeUrl: string | null, basePath?: string | null }
export function productCenterLink(apps: Application[], productCode: string, origin: string) {
  if (!productCode || productCode !== productCode.trim() || /[/\\\p{Cc}]/u.test(productCode)) return ''
  const app = apps.find(item => item.appCode === 'aims')
  if (!app?.homeUrl) return ''
  try {
    const home = new URL(app.homeUrl, origin)
    if (!['http:', 'https:'].includes(home.protocol) || home.username || home.password) return ''
    // Base paths come from the authorized app directory, never from product data.
    const base = app.basePath || (home.pathname === '/' ? '/' : '')
    if (!base.startsWith('/') || base.startsWith('//') || /[?#\\]/.test(base) || base.split('/').includes('..')) return ''
    const target = new URL(home.origin)
    target.pathname = `${base.replace(/\/+$/, '')}/products/${encodeURIComponent(productCode)}`
    const consoleHome = apps.find(item => ['workspace', 'console'].includes(item.appCode))?.homeUrl
    return applicationShellEntryUrl('aims', target.toString(), origin, consoleHome)
  } catch { return '' }
}
