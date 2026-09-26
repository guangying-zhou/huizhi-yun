export function setTenantAppRoleSelected(
  selectedRoleCodes: string[],
  roleCode: string,
  checked: boolean
): string[] {
  if (checked) {
    return selectedRoleCodes.includes(roleCode)
      ? selectedRoleCodes
      : [...selectedRoleCodes, roleCode]
  }

  return selectedRoleCodes.filter(code => code !== roleCode)
}
