export function customPolicy(payload: Record<string, unknown>) {
  const assignments = payload.roleAssignments || payload.subjectRoles
  return { assignments }
}
