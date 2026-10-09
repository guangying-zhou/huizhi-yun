import { dirname, resolve } from 'node:path'
import { readFileSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { navigationContributors } from './registry.mjs'

const hostRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const repoRoot = dirname(hostRoot)
const modules = navigationContributors.map(module => module.code)
const compositionSources = new Set(['registry.mjs', 'host-native-pages.mjs', 'business-areas.mjs'])

export function compositionRestartRequired(event, path, root = repoRoot) {
  const absolute = resolve(path)

  const host = resolve(root, 'enterprise')

  if ([...compositionSources].some(file => absolute === resolve(host, 'composition', file)))
    return true

  if (modules.some(code => absolute === resolve(root, code, 'app.manifest.json')
    || (absolute.startsWith(`${resolve(root, code, 'layer')}/`) && absolute.endsWith('.mjs'))))
    return true
  // Existing page edits use HMR. Adds/removals must reload frozen native-page
  // ownership facts before pages:extend validates the newly scanned routes.

  return ['add', 'unlink', 'addDir', 'unlinkDir'].includes(event)
    && absolute.startsWith(`${host}/app/pages/`) && absolute.endsWith('.vue')
}

// Compare final bytes/page membership, not filesystem events (atomic saves and
// generators can emit duplicates or write identical content).
export function compositionFingerprint(root = repoRoot) {
  const entries = []

  const file = (path) => {
    try {
      entries.push([path, readFileSync(path).toString('base64')])
    } catch (error) {
      if (error.code === 'ENOENT')
        entries.push([path, null])
      else
        throw error
    }
  }

  const walk = (path, suffix, content) => {
    let children

    try {
      children = readdirSync(path, { withFileTypes: true })
    } catch (error) {
      if (error.code === 'ENOENT')
        return

      throw error
    }

    for (const child of children.sort((a, b) => a.name.localeCompare(b.name))) {
      const next = resolve(path, child.name)

      if (child.isDirectory())
        walk(next, suffix, content)
      else
        if (child.isFile() && next.endsWith(suffix)) {
          if (content)
            file(next)
          else
            entries.push([next])
        }
    }
  }

  for (const source of [...compositionSources].sort())
    file(resolve(root, 'enterprise/composition', source))

  for (const code of modules) {
    file(resolve(root, code, 'app.manifest.json'))

    walk(resolve(root, code, 'layer'), '.mjs', true)
  }

  walk(resolve(root, 'enterprise/app/pages'), '.vue', false)

  return createHash('sha256').update(JSON.stringify(entries)).digest('hex')
}

export function createCompositionReload({ fingerprint, restart, schedule = setTimeout, cancel = clearTimeout, delay = 2000, failed = () => {} }) {
  let baseline = fingerprint()

  let timer

  let closed = false

  let restarting = false

  return {
    changed() {
      if (closed || restarting)
        return

      cancel(timer)

      timer = schedule(async () => {
        timer = undefined

        if (closed || restarting)
          return

        try {
          const next = fingerprint()

          if (next === baseline)
            return

          restarting = true

          await restart()

          baseline = next
        } catch {
          failed()
        } finally {
          restarting = false
        }
      }, delay)

      timer?.unref?.()
    },
    close() {
      closed = true

      cancel(timer)
    }
  }
}

// hzy0 serves an immutable candidate. Structure changes are applied only by
// an explicit candidate switch; ordinary development keeps Nuxt's own watcher.
export default function installCompositionDevWatch() {}
