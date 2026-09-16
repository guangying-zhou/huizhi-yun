/** Platform's configured identity, never a caller-controlled Host header. */
export function runtimeBootstrapIssuer(configured: unknown): string {
  const value = String(configured || '').trim()
  if (!value) throw new Error('Platform service URL is required')
  const url = new URL(value)
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:'))
    || url.username || url.password || url.search || url.hash) {
    throw new Error('Platform service URL is invalid')
  }
  return url.toString().replace(/\/+$/u, '')
}
