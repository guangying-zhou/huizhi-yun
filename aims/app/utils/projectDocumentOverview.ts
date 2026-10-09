export interface AccessibleProjectDocumentPage<T> {
  items: T[]
  total: number
}

// Selection and sidebar counts use the same owning ACL-filtered response. Only
// concurrent reads are shared; no cross-session or long-lived ACL cache exists.
export function createProjectDocumentReader<T>(fetchPage: (projectId: number) => Promise<{ code: number, data: AccessibleProjectDocumentPage<T> }>) {
  const flights = new Map<number, Promise<AccessibleProjectDocumentPage<T>>>()
  return (projectId: number) => {
    const existing = flights.get(projectId)
    if (existing) return existing
    const flight = Promise.resolve().then(() => fetchPage(projectId)).then((response) => {
      if (response.code !== 0 || !Array.isArray(response.data?.items) || !Number.isSafeInteger(response.data.total) || response.data.total < 0) {
        throw new Error('可访问文档数据暂不可用，请重试')
      }
      return response.data
    }).finally(() => flights.delete(projectId))
    flights.set(projectId, flight)
    return flight
  }
}

export async function loadProjectDocumentCounts<T>(projectIds: number[], read: (id: number) => Promise<AccessibleProjectDocumentPage<T>>, accept: (id: number, total: number | null) => void, active: () => boolean) {
  const ids = [...new Set(projectIds)]
  let next = 0
  await Promise.all(Array.from({ length: Math.min(3, ids.length) }, async () => {
    while (active() && next < ids.length) {
      const id = ids[next++]!
      try {
        const page = await read(id)
        if (active()) accept(id, page.total)
      } catch {
        if (active()) accept(id, null)
      }
    }
  }))
}
