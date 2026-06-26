export function projectEnvironmentDeploymentStatus(deliveryStatus: string) {
  switch (deliveryStatus) {
    case 'provisioning':
      return 'provisioning'
    case 'deployed':
      return 'deployed'
    case 'online':
      return 'online'
    case 'accepted':
    case 'handed_over':
      return 'accepted'
    case 'suspended':
      return 'suspended'
    case 'cancelled':
      return 'removed'
    default:
      return 'planned'
  }
}

export function projectEnvironmentLifecycleStatus(deliveryStatus: string) {
  switch (deliveryStatus) {
    case 'online':
      return 'active'
    case 'accepted':
    case 'handed_over':
      return 'accepted'
    case 'suspended':
      return 'frozen'
    default:
      return ''
  }
}
