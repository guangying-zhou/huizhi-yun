import { readFileSync } from 'node:fs'

export const altocNavigationManifest = JSON.parse(readFileSync(new URL('../app.manifest.json', import.meta.url), 'utf8'))
// Navigation contributor only; not an installed Altoc application layer.
export default Object.freeze({ code: altocNavigationManifest.appCode, label: '经营管理', hostNavigation: altocNavigationManifest.hostNavigation })
