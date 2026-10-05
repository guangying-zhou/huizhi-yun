#!/usr/bin/env node
// Read-only drift check for the registered standalone Collab deployment code.
// Every place that names it must equal `${tenant}-collab` (the value the G-9
// Platform registration writes). Inputs are local files/values only; nothing is
// contacted. Exit 1 on drift, listing the sources (never file contents).
//
//   node check-collab-deployment.mjs --tenant C000001 \
//     [--platform <deployment_code read back by g9-collab-deployment.mjs --verify>] \
//     [--gateway /etc/hzy-gateway/gateway.json] [--g7 g7-config.json] \
//     [--collab-registration collab-config.json] [--runtime-binding <deploymentBindings.collab>]
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { checkCollabDeploymentAgreement } from './collab-deployment.mjs'

const json = path => JSON.parse(readFileSync(path, 'utf8'))

export function collectCollabSources(values, read = json) {
  const sources = {}
  if (values.platform !== undefined) sources.platform = values.platform
  if (values['runtime-binding'] !== undefined) sources.runtimeBinding = values['runtime-binding']
  const notes = []
  if (values.gateway) {
    const gateway = read(values.gateway)
    if (gateway.site?.tenantCode !== values.tenant) sources.gatewayTenant = gateway.site?.tenantCode ?? '(missing)'
    // An absent pin is legal (collab unpinned) but reported so readiness is explicit.
    if (gateway.apps?.collab?.deploymentCode === undefined) notes.push('gateway apps.collab.deploymentCode not pinned')
    else sources.gateway = gateway.apps.collab.deploymentCode
  }
  if (values.g7) {
    const code = read(values.g7).bindings?.deployments?.collab
    if (code === undefined) notes.push('g7 bindings.deployments.collab not set (collab grants not in G-7 plan)')
    else sources.g7 = code
  }
  if (values['collab-registration']) {
    const bindings = read(values['collab-registration']).bindings
    if (bindings?.tenant !== values.tenant) sources.collabRegistrationTenant = bindings?.tenant ?? '(missing)'
    // Absent deployments.collab defaults to the registered code.
    if (bindings?.deployments?.collab !== undefined) sources.collabRegistration = bindings.deployments.collab
  }
  return { sources, notes }
}

export function runCheck(values, read = json) {
  const { sources, notes } = collectCollabSources(values, read)
  // *Tenant entries compare a tenant code, not a deployment code: fold them into the same equality by mapping.
  const tenantDrift = Object.entries(sources).filter(([name]) => name.endsWith('Tenant'))
  const deploymentSources = Object.fromEntries(Object.entries(sources).filter(([name]) => !name.endsWith('Tenant')))
  const { expected, drift } = checkCollabDeploymentAgreement({ tenant: values.tenant, sources: deploymentSources }, { strict: false })
  for (const [name, actual] of tenantDrift) drift.push({ source: name, expected: values.tenant, actual: String(actual) })
  return { ok: drift.length === 0, expected, checked: Object.keys(sources), notes, drift }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { tenant: { type: 'string' }, platform: { type: 'string' }, gateway: { type: 'string' },
    g7: { type: 'string' }, 'collab-registration': { type: 'string' }, 'runtime-binding': { type: 'string' } } })
  if (!values.tenant) { console.error('usage: check-collab-deployment.mjs --tenant C000001 [--platform CODE] [--gateway FILE] [--g7 FILE] [--collab-registration FILE] [--runtime-binding CODE]'); process.exit(2) }
  const result = runCheck(values)
  console.log(JSON.stringify(result))
  process.exitCode = result.ok ? 0 : 1
}
