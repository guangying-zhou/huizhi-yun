export interface PeopleEmployeeSearchRoutePolicy {
  transportScope: 'people.read'
  permission: {
    resource: 'employees'
    action: 'view'
  }
}

export function peopleEmployeeSearchRoutePolicy(
  suffix: string,
  method: string
): PeopleEmployeeSearchRoutePolicy | null {
  if (method !== 'POST' || suffix !== '/employees:search') return null
  return {
    transportScope: 'people.read',
    permission: {
      resource: 'employees',
      action: 'view'
    }
  }
}
