export function useCapabilities() {
  const { capabilities, hasCapability, loadAuthorization, loaded } = usePlatformPermission()

  return {
    capabilities,
    hasCapability,
    loadCapabilities: loadAuthorization,
    loaded
  }
}
