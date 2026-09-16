interface MermaidCacheEntry {
  key: string
  svg: string
  updatedAt: number
}

interface CreateMermaidSvgCacheOptions {
  namespace: string
  getVariant: () => string
  maxMemoryEntries?: number
  maxSourceChars?: number
  maxSvgChars?: number
  maxPersistentEntries?: number
  ttlMs?: number
}

const DEFAULT_MAX_MEMORY_ENTRIES = 24
const DEFAULT_MAX_SOURCE_CHARS = 12000
const DEFAULT_MAX_SVG_CHARS = 120000
const DEFAULT_MAX_PERSISTENT_ENTRIES = 128
const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000
const DB_VERSION = 1
const STORE_NAME = 'mermaid_svg_cache'

const requestToPromise = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  request.onsuccess = () => resolve(request.result)
  request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
})

const transactionToPromise = (transaction: IDBTransaction) => new Promise<void>((resolve, reject) => {
  transaction.oncomplete = () => resolve()
  transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'))
  transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'))
})

const fallbackHash = (input: string) => {
  let hash = 2166136261
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

const hashString = async (input: string) => {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    return fallbackHash(input)
  }

  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
}

export const createMermaidSvgCache = ({
  namespace,
  getVariant,
  maxMemoryEntries = DEFAULT_MAX_MEMORY_ENTRIES,
  maxSourceChars = DEFAULT_MAX_SOURCE_CHARS,
  maxSvgChars = DEFAULT_MAX_SVG_CHARS,
  maxPersistentEntries = DEFAULT_MAX_PERSISTENT_ENTRIES,
  ttlMs = DEFAULT_TTL_MS
}: CreateMermaidSvgCacheOptions) => {
  const memoryCache = new Map<string, string>()
  let dbPromise: Promise<IDBDatabase | null> | null = null
  let pruneTimer: number | null = null

  const isCacheable = (content: string, svg?: string) => {
    if (!content || content.length > maxSourceChars) return false
    if (typeof svg === 'string' && (!svg || svg.length > maxSvgChars)) return false
    return true
  }

  const touchMemoryEntry = (content: string, svg: string) => {
    if (memoryCache.has(content)) {
      memoryCache.delete(content)
    }
    memoryCache.set(content, svg)

    while (memoryCache.size > maxMemoryEntries) {
      const oldestKey = memoryCache.keys().next().value
      if (!oldestKey) break
      memoryCache.delete(oldestKey)
    }
  }

  const buildCacheKey = async (content: string) => {
    const rawKey = `${namespace}|${getVariant()}|${content}`
    return `${namespace}:${await hashString(rawKey)}`
  }

  const openDb = async () => {
    if (typeof indexedDB === 'undefined') return null
    if (dbPromise) return dbPromise

    dbPromise = new Promise<IDBDatabase | null>((resolve) => {
      const request = indexedDB.open(namespace, DB_VERSION)

      request.onupgradeneeded = () => {
        const database = request.result
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          const store = database.createObjectStore(STORE_NAME, { keyPath: 'key' })
          store.createIndex('updatedAt', 'updatedAt')
        }
      }

      request.onsuccess = () => resolve(request.result)
      request.onerror = () => {
        console.warn('Failed to open Mermaid cache database:', request.error)
        resolve(null)
      }
    })

    return dbPromise
  }

  const clearMemory = () => {
    memoryCache.clear()
  }

  const getFromMemory = (content: string) => {
    const cached = memoryCache.get(content)
    if (!cached) return null
    touchMemoryEntry(content, cached)
    return cached
  }

  const deletePersistentByKey = async (key: string) => {
    const db = await openDb()
    if (!db) return

    const transaction = db.transaction(STORE_NAME, 'readwrite')
    transaction.objectStore(STORE_NAME).delete(key)
    await transactionToPromise(transaction)
  }

  const prunePersistentCache = async () => {
    const db = await openDb()
    if (!db) return

    const transaction = db.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    const entries = await requestToPromise(store.getAll()) as MermaidCacheEntry[]
    const now = Date.now()
    const staleEntries = entries.filter(entry => now - entry.updatedAt > ttlMs)

    for (const entry of staleEntries) {
      store.delete(entry.key)
    }

    const freshEntries = entries
      .filter(entry => now - entry.updatedAt <= ttlMs)
      .sort((left, right) => left.updatedAt - right.updatedAt)

    while (freshEntries.length > maxPersistentEntries) {
      const oldestEntry = freshEntries.shift()
      if (!oldestEntry) break
      store.delete(oldestEntry.key)
    }

    await transactionToPromise(transaction)
  }

  const schedulePersistentPrune = () => {
    if (typeof window === 'undefined' || pruneTimer !== null) return
    pruneTimer = window.setTimeout(async () => {
      pruneTimer = null
      try {
        await prunePersistentCache()
      } catch (error) {
        console.warn('Failed to prune Mermaid cache:', error)
      }
    }, 2000)
  }

  const getFromPersistent = async (content: string) => {
    if (!isCacheable(content)) return null

    const db = await openDb()
    if (!db) return null

    const key = await buildCacheKey(content)
    const transaction = db.transaction(STORE_NAME, 'readonly')
    const entry = await requestToPromise(transaction.objectStore(STORE_NAME).get(key)) as MermaidCacheEntry | undefined
    await transactionToPromise(transaction)

    if (!entry) return null
    if (Date.now() - entry.updatedAt > ttlMs) {
      void deletePersistentByKey(key)
      return null
    }

    touchMemoryEntry(content, entry.svg)
    return entry.svg
  }

  const setPersistent = async (content: string, svg: string) => {
    if (!isCacheable(content, svg)) return

    touchMemoryEntry(content, svg)

    const db = await openDb()
    if (!db) return

    const key = await buildCacheKey(content)
    const transaction = db.transaction(STORE_NAME, 'readwrite')
    transaction.objectStore(STORE_NAME).put({
      key,
      svg,
      updatedAt: Date.now()
    } satisfies MermaidCacheEntry)
    await transactionToPromise(transaction)
    schedulePersistentPrune()
  }

  const destroy = () => {
    clearMemory()

    if (pruneTimer !== null && typeof window !== 'undefined') {
      window.clearTimeout(pruneTimer)
      pruneTimer = null
    }

    if (dbPromise) {
      void dbPromise.then((database) => {
        database?.close()
      })
      dbPromise = null
    }
  }

  return {
    getFromMemory,
    getFromPersistent,
    setPersistent,
    clearMemory,
    destroy
  }
}
