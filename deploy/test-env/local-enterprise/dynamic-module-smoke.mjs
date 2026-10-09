import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Probe transformed modules through ingress, not only HTML and @vite/client.
// These composed Codocs routes failed when its Nuxt preparation was omitted.
export function dynamicModulePaths(root = fileURLToPath(new URL('../../../', import.meta.url))) {
  const prefix = '/enterprise/_nuxt/@fs'
  const files = [
    'codocs/app/pages/mydocs/index.vue',
    'codocs/layer/pages/enterprise-department-documents.vue'
  ]
  return [
    prefix + encodeURI(realpathSync(`${root}/enterprise/node_modules/nuxt/dist/app/entry.js`)),
    ...files.flatMap(file => [prefix + encodeURI(resolve(root, file)) + '?macro=true', prefix + encodeURI(resolve(root, file))])
  ]
}

export async function probeDynamicModules(get, paths = dynamicModulePaths()) {
  const results = []
  for (const path of paths) {
    const response = await get(path)
    results.push({ path, status: response.status, passed: response.status === 200 && /(?:export|import)\s/.test(response.body) && !response.body.includes('vite-error-overlay') })
  }
  return results
}
