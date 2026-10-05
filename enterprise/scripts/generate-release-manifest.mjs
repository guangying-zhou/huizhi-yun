import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildReleaseManifest, composeManifest, digest, releaseSourcePaths, releaseBuildFiles } from './manifest-artifacts.mjs'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const [inputPath, outputPath] = process.argv.slice(2)
if (!inputPath || !outputPath) throw Error('Usage: node generate-release-manifest.mjs <build-input.json> <output.json>')
const input = JSON.parse(readFileSync(resolve(inputPath), 'utf8'))
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
const sources = {}
for (const module of releaseSourcePaths) {
  if (git(['status', '--porcelain', '--', module])) throw Error(`Uncommitted ${module} source; release manifest requires committed build inputs`)
  sources[module] = { commit: git(['rev-parse', 'HEAD']), tree: git(['rev-parse', `HEAD:${module}`]) }
}
const buildFiles = {}
for (const file of releaseBuildFiles) {
  if (git(['status', '--porcelain', '--', file])) throw Error(`Uncommitted build input ${file}`)
  buildFiles[file] = { blob: git(['rev-parse', `HEAD:${file}`]) }
}
const appManifest = JSON.parse(readFileSync(resolve(root, 'enterprise/app.manifest.json'), 'utf8'))
const expected = composeManifest(['aims', 'assets', 'codocs'].map(app => JSON.parse(readFileSync(resolve(root, app, 'app.manifest.json'), 'utf8'))))
if (digest(expected) !== digest(appManifest)) throw Error('Generated application manifest is stale')
for (const [section, pathField, hashField] of [['runtime','artifactPath','artifactSha256'], ['schema','manifestPath','manifestSha256'], ['paths','registryPath','registrySha256']]) {
  const path = input[section]?.[pathField]
  if (typeof path !== 'string' || !path) throw Error(`Missing ${section}.${pathField}`)
  const hash = createHash('sha256').update(readFileSync(resolve(path))).digest('hex')
  if (input[section][hashField] && input[section][hashField] !== hash) throw Error(`${section} artifact hash mismatch`)
  input[section][hashField] = hash
  delete input[section][pathField]
}
const artifact = buildReleaseManifest({ ...input, sources, buildFiles, builtAt: new Date().toISOString() }, appManifest)
writeFileSync(resolve(outputPath), JSON.stringify(artifact, null, 2) + '\n')
