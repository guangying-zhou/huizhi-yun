/**
 * Compatibility stub for useBusiness composable
 * Original SaaS multi-tenant composable replaced with single-instance defaults
 */
export function useBusiness() {
  return {
    name: ref('default'),
    business: ref(null),
    resolve: () => Promise.resolve(),
    isCustomDomain: ref(false),
    domain: ref('')
  }
}
