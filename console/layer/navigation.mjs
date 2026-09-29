import { readFileSync } from 'node:fs'

// Navigation only: this is not a Nuxt layer or an installed composition module.
export const consoleNavigationManifest = JSON.parse(readFileSync(new URL('../app.manifest.json', import.meta.url), 'utf8'))
export default Object.freeze({ code: consoleNavigationManifest.appCode, label: '企业基础服务', hostNavigation: consoleNavigationManifest.hostNavigation })
