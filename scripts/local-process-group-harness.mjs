#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import process from 'node:process'
import { isAbsolute, relative, resolve } from 'node:path'
import {
  LocalProcessGroupConfigurationError,
  buildLocalProcessGroupPlan,
  isSensitiveProcessValueName,
  withLocalProcessGroup
} from './test/support/local-process-group-supervisor.mjs'

function usage() {
  return `Usage (preview by default; starts no process):
  pnpm run harness:process-group -- --manifest <workspace-plan.json>

Execute only after reviewing the exact digest:
  pnpm run harness:process-group -- --manifest <workspace-plan.json> \
    --execute --confirm <confirmation-sha256>

The manifest declares schemaVersion=1, totalTimeoutMs, allowedEnvironment,
optional caFile, and an ordered processes array containing name, command, args,
cwd, non-sensitive literal env, envFrom, and readiness { url, status }.
Sensitive values must use envFrom, for example DB_PASSWORD=HZY_G3_DB_PASSWORD,
and every HZY_G3_* source must also appear in allowedSourceEnvironment.
Environment values and command args are bound into the confirmation digest but
are never printed. The digest also binds each PATH-resolved executable's
canonical path and SHA-256 plus the inherited dynamic-library environment;
changed executable, CA, PATH, or runtime-library inputs require a new preview.
This command does not read .env, .env.dev, module runtime configuration, hosts,
or external URLs.`
}

function optionValue(argv, index, raw) {
  const equals = raw.indexOf('=')
  if (equals >= 0) return { value: raw.slice(equals + 1), next: index }
  const value = argv[index + 1]
  if (!value || value.startsWith('--')) throw new LocalProcessGroupConfigurationError(`missing value for ${raw}`)
  return { value, next: index + 1 }
}

export function parseLocalProcessGroupArgs(argv) {
  const args = { manifest: '', execute: false, confirm: '', help: false }
  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index]
    if (raw === '--') continue
    if (raw === '--help' || raw === '-h') { args.help = true; continue }
    if (raw === '--execute') { args.execute = true; continue }
    if (!raw.startsWith('--')) throw new LocalProcessGroupConfigurationError(`unexpected argument: ${raw}`)
    const name = raw.slice(2).split('=', 1)[0]
    if (isSensitiveProcessValueName(name)) {
      throw new LocalProcessGroupConfigurationError(`--${name} is forbidden; use an allowlisted manifest environment entry`)
    }
    const option = optionValue(argv, index, raw)
    index = option.next
    if (name === 'manifest') args.manifest = option.value
    else if (name === 'confirm') args.confirm = option.value
    else throw new LocalProcessGroupConfigurationError(`unknown option: --${name}`)
  }
  return args
}

function workspacePath(rootDir, input, label) {
  const absolute = resolve(rootDir, input)
  const rel = relative(rootDir, absolute)
  if (rel === '..' || rel.startsWith('../') || isAbsolute(rel)) {
    throw new LocalProcessGroupConfigurationError(`${label} must stay inside the workspace`)
  }
  return absolute
}

export function resolveManifestProcessEnvironment(manifest, environment = process.env) {
  const allowedSources = new Set(manifest.allowedSourceEnvironment || [])
  for (const source of allowedSources) {
    if (!/^HZY_G3_[A-Z0-9_]+$/.test(source)) {
      throw new LocalProcessGroupConfigurationError(`invalid allowedSourceEnvironment name: ${source}`)
    }
  }
  return (manifest.processes || []).map((processSpec) => {
    const literal = { ...(processSpec.env || {}) }
    for (const [key, value] of Object.entries(literal)) {
      if (isSensitiveProcessValueName(key) && String(value || '')) {
        throw new LocalProcessGroupConfigurationError(`${processSpec.name} sensitive environment ${key} must use envFrom`)
      }
    }
    for (const [target, source] of Object.entries(processSpec.envFrom || {})) {
      if (Object.hasOwn(literal, target)) {
        throw new LocalProcessGroupConfigurationError(`${processSpec.name} environment ${target} cannot appear in both env and envFrom`)
      }
      if (!/^HZY_G3_[A-Z0-9_]+$/.test(String(source)) || !allowedSources.has(source)) {
        throw new LocalProcessGroupConfigurationError(`${processSpec.name} envFrom source is not explicitly allowlisted: ${source}`)
      }
      const value = environment[source]
      if (value === undefined || value === null || String(value) === '') {
        throw new LocalProcessGroupConfigurationError(`${processSpec.name} envFrom source is missing: ${source}`)
      }
      literal[target] = String(value)
    }
    return { ...processSpec, env: literal }
  })
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseLocalProcessGroupArgs(argv)
  if (args.help) {
    console.info(usage())
    return 0
  }
  if (!args.manifest) throw new LocalProcessGroupConfigurationError('--manifest is required')
  const rootDir = process.cwd()
  const manifestPath = workspacePath(rootDir, args.manifest, 'manifest')
  let manifest
  try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')) } catch (error) {
    throw new LocalProcessGroupConfigurationError(`cannot read process-group manifest: ${error.message}`)
  }
  if (manifest.schemaVersion !== 1) throw new LocalProcessGroupConfigurationError('manifest schemaVersion must be 1')
  const processes = resolveManifestProcessEnvironment(manifest)
  const plan = await buildLocalProcessGroupPlan({
    rootDir,
    allowedWorkingRoots: [rootDir],
    allowedFileRoots: [rootDir],
    allowedEnvironment: manifest.allowedEnvironment,
    caFile: manifest.caFile ? workspacePath(rootDir, manifest.caFile, 'caFile') : '',
    totalTimeoutMs: manifest.totalTimeoutMs,
    pollMs: manifest.pollMs,
    processes
  })
  console.info(`[process-group] mode=${args.execute ? 'execute' : 'preview'} processes=${plan.processes.length} timeoutMs=${plan.totalTimeoutMs}`)
  console.info(`[process-group] nodeOptions=${plan.nodeOptions} ca=${plan.caFile ? plan.caFile.path : 'none'}`)
  for (const [index, item] of plan.processes.entries()) {
    console.info(`[process-group] ${index + 1}. name=${item.name} command=${item.command} argCount=${item.argCount} argsSha256=${item.argsSha256} cwd=${item.cwd} readiness=${item.readiness.url}->${item.readiness.status} envKeys=${item.environmentKeys.join(',') || 'none'}`)
  }
  console.info(`[process-group] confirmationSha256=${plan.confirmationSha256}`)
  if (!args.execute) {
    console.info('[process-group] preview complete; no process or temporary HOME was created.')
    return 0
  }
  await withLocalProcessGroup(plan, async (context) => {
    console.info(`[process-group] ready=${context.processes.map(item => item.name).join(',')}; callback completes immediately for lifecycle validation`)
  }, { execute: true, confirm: args.confirm })
  console.info('[process-group] complete; all process groups stopped in reverse order.')
  return 0
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  main().then(
    code => { process.exitCode = code },
    error => {
      console.error(`[process-group] ${error.message}`)
      process.exitCode = 1
    }
  )
}
