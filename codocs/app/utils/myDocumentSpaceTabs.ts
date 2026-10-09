export const myDocumentSpaceTabs = [
  { label: '我的文档', path: '/mydocs' },
  { label: '最近使用', path: '/mydocs/recently' },
  { label: '与我协同', path: '/mydocs/shared' },
  { label: '收藏', path: '/mydocs/favorites' },
  { label: '回收站', path: '/mydocs/recycle' }
] as const

export function activeMyDocumentSpaceTab(path: string) {
  const normalized = path.split(/[?#]/)[0]!.replace(/^\/codocs(?=\/)/, '').replace(/\/$/, '')
  return myDocumentSpaceTabs.find(tab => tab.path === normalized)?.path || null
}
