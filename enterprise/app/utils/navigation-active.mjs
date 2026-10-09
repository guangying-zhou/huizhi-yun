export function flattenNavigationLeaves(tree) {
  return tree.flatMap(item => item.children?.length ? flattenNavigationLeaves(item.children) : item.to ? [item] : [])
}

export function selectActiveLeaf(tree, path, preferredId = '') {
  const candidates = flattenNavigationLeaves(tree).filter(item => item.to && (path === item.to || path.startsWith(`${item.to}/`)))
  if (!candidates.length) return ''
  const longest = Math.max(...candidates.map(item => item.to.length))
  const exact = candidates.filter(item => item.to.length === longest)
  return exact.find(item => item.id === preferredId)?.id || exact.map(item => item.id).sort()[0]
}
