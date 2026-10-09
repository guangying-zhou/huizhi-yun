/**
 * 汇智云粘贴板 — 内存缓存
 *
 * 每个用户(uid)只保留最新一条，覆盖式写入，TTL 30 分钟后自动过期。
 */

interface ClipboardEntry {
  content: string
  contentType: string
  sourceApp: string
  createdAt: number
}

const CLIPBOARD_TTL = 30 * 60 * 1000 // 30 minutes

const store = new Map<string, ClipboardEntry>()

/** 写入粘贴板（覆盖） */
export function clipboardSet(uid: string, entry: Omit<ClipboardEntry, 'createdAt'>): void {
  store.set(uid, { ...entry, createdAt: Date.now() })
}

/** 读取粘贴板（过期返回 null） */
export function clipboardGet(uid: string): ClipboardEntry | null {
  const entry = store.get(uid)
  if (!entry) return null
  if (Date.now() - entry.createdAt > CLIPBOARD_TTL) {
    store.delete(uid)
    return null
  }
  return entry
}

/** 清除粘贴板 */
export function clipboardDelete(uid: string): boolean {
  return store.delete(uid)
}

// 每 10 分钟清理过期条目，防止内存泄漏
setInterval(() => {
  const now = Date.now()
  for (const [uid, entry] of store) {
    if (now - entry.createdAt > CLIPBOARD_TTL) {
      store.delete(uid)
    }
  }
}, 10 * 60 * 1000)
