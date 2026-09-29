import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

export function drainWorkerConfig(config) {
  if (!['hzy-test-aims', 'hzy-test-assets'].includes(config.name)) throw Error('Drain only supports the two migration sources')
  return { ...config, main: './drain-entry.mjs', services: [...config.services, { binding: 'HZY_DRAIN_COORDINATOR', service: 'hzy-test-drain-coordinator' }] }
}

export async function drainArtifactHash(serverDirectory, boundarySource) {
  const hash = createHash('sha256')
  async function visit(directory) {
    for (const item of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, item.name)
      if (item.isDirectory()) await visit(path)
      else if (item.isFile()) {
        const bytes = await readFile(path)
        hash.update(JSON.stringify([relative(serverDirectory, path), bytes.length]) + '\n').update(bytes)
      } else throw Error('Drain artifact cannot contain symlinks or special files')
    }
  }
  await visit(serverDirectory)
  hash.update(JSON.stringify(['worker-boundary.mjs', Buffer.byteLength(boundarySource)]) + '\n').update(boundarySource)
  return hash.digest('hex')
}

export function coordinatorConfig() {
  return { name: 'hzy-test-drain-coordinator', main: './coordinator.mjs', compatibility_date: '2026-09-01', workers_dev: false,
    durable_objects: { bindings: [{ name: 'HZY_DRAIN_STATE', class_name: 'TestDrainCoordinator' }] },
    migrations: [{ tag: 'v1', new_sqlite_classes: ['TestDrainCoordinator'] }] }
}
