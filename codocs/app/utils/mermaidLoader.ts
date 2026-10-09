import type { MermaidConfig } from 'mermaid'

type MermaidApi = typeof import('mermaid')['default']

export const MERMAID_RUNTIME_VARIANT = 'mermaid-11.13'

let mermaidPromise: Promise<MermaidApi> | null = null
let operationQueue: Promise<void> = Promise.resolve()

export function loadMermaid() {
  mermaidPromise ||= import('mermaid').then(module => module.default)
  return mermaidPromise
}

/**
 * Mermaid configuration is process-global. Serialize initialize + render so
 * editor theme changes and review charts cannot overwrite each other midway.
 */
export function withMermaid<T>(config: MermaidConfig, task: (api: MermaidApi) => Promise<T>) {
  const operation = operationQueue.then(async () => {
    const api = await loadMermaid()
    api.initialize(config)
    return task(api)
  })
  operationQueue = operation.then(() => undefined, () => undefined)
  return operation
}

export function renderMermaid(config: MermaidConfig, id: string, definition: string) {
  return withMermaid(config, api => api.render(id, definition))
}
