/** Directory is the sole account-state authority. Unknown is not selectable. */
export function isActiveDirectoryUser(status: unknown): boolean {
  return status === 1 || status === 'active'
}
