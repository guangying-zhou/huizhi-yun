import { registerHooks } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve, dirname } from 'node:path'

/** Resolve Nuxt's build aliases for actual source modules; only inject the host environment. */
export function registerEnterpriseNuxtTestHost(rootDir, { policyStore = false } = {}) {
  const host = `export const useRuntimeConfig = (...args) => globalThis.useRuntimeConfig(...args); export const useEvent = () => globalThis.__enterpriseTestEvent; export const useRequestEvent = () => globalThis.__enterpriseTestEvent;`
  return registerHooks({
    load(url, context, nextLoad) {
      if (url.startsWith('file:') && url.endsWith('.json')) return { format: 'module', source: `export default ${readFileSync(fileURLToPath(url), 'utf8')}`, shortCircuit: true }
      return nextLoad(url, context)
    },
    resolve(specifier, context, nextResolve) {
      if (policyStore && specifier === '@hzy/foundation/server/utils/consolePolicyStore') return { url: `data:text/javascript,${encodeURIComponent('export const consolePolicyStore = () => globalThis.__enterprisePolicyStore')}`, shortCircuit: true }
      if (specifier === '#imports' || specifier === 'nitropack/runtime') return { url: `data:text/javascript,${encodeURIComponent(host)}`, shortCircuit: true }
      const parent = context.parentURL?.startsWith('file:') ? fileURLToPath(context.parentURL) : ''
      let candidate
      if (specifier.startsWith('~~/') || specifier.startsWith('~/')) {
        const moduleName = parent.includes('/platform/') ? 'platform' : parent.includes('/console/') ? 'console' : 'foundation'
        candidate = resolve(rootDir, moduleName, specifier.replace(/^~~?\//, ''))
      } else if (specifier.startsWith('.') && parent) candidate = resolve(dirname(parent), specifier)
      if (candidate && !existsSync(candidate) && existsSync(`${candidate}.ts`)) return { url: pathToFileURL(`${candidate}.ts`).href, shortCircuit: true }
      if (candidate && existsSync(candidate)) return { url: pathToFileURL(candidate).href, shortCircuit: true }
      return nextResolve(specifier, context)
    }
  })
}
