import { existsSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'

// Nuxt resolves extensionless TypeScript source imports. Native Node strips
// types but needs the same resolution for isolated server contract tests.
// Test-only: never alter production imports or substitute module contents.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
      const candidate = new URL(specifier, context.parentURL)
      if (!existsSync(fileURLToPath(candidate))) {
        const typed = new URL(candidate.href + '.ts')
        if (existsSync(fileURLToPath(typed))) return nextResolve(typed.href, context)
      }
    }
    return nextResolve(specifier, context)
  }
})
