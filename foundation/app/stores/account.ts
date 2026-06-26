/**
 * Backward-compatible Account Store entry.
 *
 * Directory data is now served by Console Directory Runtime through
 * `/api/directory/**`; keep the old export so existing business code can
 * migrate names gradually.
 */
export { useDirectoryStore as useAccountStore } from './directory'
