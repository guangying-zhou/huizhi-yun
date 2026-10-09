// A declared production platform environment can never enable a development
// bypass, whatever the run mode or NODE_ENV says. Unknown values are not
// treated as production here; callers keep their own fail-closed defaults.
export function isProductionPlatformEnvironment(value: unknown) {
  return ['prod', 'production'].includes(String(value || '').trim().toLowerCase())
}
