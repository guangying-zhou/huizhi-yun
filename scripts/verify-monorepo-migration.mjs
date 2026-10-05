import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const workspaceRoot = resolve(scriptDir, '..')
const recordRoot = resolve(workspaceRoot, 'docs/monorepo-migration')
const inventory = JSON.parse(readFileSync(resolve(recordRoot, 'inventory.json'), 'utf8'))

function git(args) {
  return execFileSync('git', args, { cwd: workspaceRoot, encoding: 'utf8' }).trim()
}

function fail(message) {
  console.error(`FAIL ${message}`)
  process.exitCode = 1
}

for (const repository of inventory.repositories) {
  try {
    git(['cat-file', '-e', `${repository.newHead}^{commit}`])
    if (repository.path === '.') {
      const tree = git(['rev-parse', `${repository.newHead}^{tree}`])
      if (tree !== repository.oldTree) fail(`${repository.name}: root tree mismatch`)
    } else {
      const tree = git(['rev-parse', `${repository.newHead}:${repository.path}`])
      if (tree !== repository.oldTree) fail(`${repository.name}: subtree mismatch`)

      const map = readFileSync(resolve(recordRoot, 'commit-maps', `${repository.name}.tsv`), 'utf8')
      const mapping = map.split(/\r?\n/).find(line => line.startsWith(`${repository.oldHead} `))
      if (!mapping || mapping.trim().split(/\s+/)[1] !== repository.newHead) {
        fail(`${repository.name}: HEAD commit-map mismatch`)
      }
    }

    const migratedTags = git(['tag', '--merged', repository.newHead, '--list', `${repository.name}/*`])
    const migratedTagCount = migratedTags ? migratedTags.split(/\r?\n/).length : 0
    if (migratedTagCount !== repository.tagCount) {
      fail(`${repository.name}: expected ${repository.tagCount} migrated tags, got ${migratedTagCount}`)
    }

    const allTags = git(['tag', '--list', `${repository.name}/*`])
    const postMigrationTagCount = (allTags ? allTags.split(/\r?\n/).length : 0) - migratedTagCount
    const postMigrationSummary = postMigrationTagCount > 0 ? ` (+${postMigrationTagCount} post-migration)` : ''
    console.log(`OK   ${repository.name}: tree and ${migratedTagCount} migrated tags${postMigrationSummary}`)
  } catch (error) {
    fail(`${repository.name}: ${error.message}`)
  }
}

const bareVersionTags = git(['tag', '--list', 'v*'])
if (bareVersionTags) fail(`unscoped version tags remain: ${bareVersionTags.replace(/\n/g, ', ')}`)

const nestedGit = git(['ls-files', ':(glob)**/.git'])
if (nestedGit) fail(`nested .git paths are tracked: ${nestedGit.replace(/\n/g, ', ')}`)

const trackedEnv = git(['ls-files', ':(glob)**/.env', ':(glob)**/.env.dev'])
if (trackedEnv) fail(`local env files are tracked: ${trackedEnv.replace(/\n/g, ', ')}`)

if (!process.exitCode) console.log('Monorepo migration verification passed.')
