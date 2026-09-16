export function hasPermission(actions: string[], action: string) {
  if (action === 'view') {
    return actions.includes('view') || actions.includes('edit') || actions.includes('admin')
  }
  if (action === 'edit') return actions.includes('edit') || actions.includes('admin')
  return actions.includes(action)
}
