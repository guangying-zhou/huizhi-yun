export function createScopedRuntimeRegistry<Scope extends object, Runtime>(factory: () => Runtime) {
  const runtimes = new WeakMap<Scope, Runtime>()

  return (scope: Scope) => {
    const existing = runtimes.get(scope)
    if (existing) return existing

    const runtime = factory()
    runtimes.set(scope, runtime)
    return runtime
  }
}
