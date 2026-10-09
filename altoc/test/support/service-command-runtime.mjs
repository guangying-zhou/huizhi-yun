// Standard Node strip-types does not apply Nuxt's extension resolution. Load the
// real Foundation signing code; this hook only resolves existing relative files.
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const hooks = registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
    const path = resolve(dirname(fileURLToPath(context.parentURL)), specifier)
    if (!existsSync(path) && existsSync(`${path}.ts`)) return { url: pathToFileURL(`${path}.ts`).href, shortCircuit: true }
  }
  return next(specifier, context)
} })
const runtime = await import('../../../foundation/server/utils/tenantRuntimeClient.ts')
hooks.deregister()
export const { hashServiceCommandPayload, buildServiceCommandRuntimeHeaders, verifyServiceCommandRuntimeHeaders } = runtime
