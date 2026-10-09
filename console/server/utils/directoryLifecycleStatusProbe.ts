import { createError } from 'h3'

export function normalizeLifecycleProbe(query: Record<string, unknown>) {
  if (Object.keys(query).sort().join(',') !== 'hash,kind,revision,uid' || typeof query.kind !== 'string' || !['employment', 'offboarding'].includes(query.kind) || typeof query.uid !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._@-]{0,63}$/.test(query.uid) || typeof query.hash !== 'string' || !/^[a-f0-9]{64}$/.test(query.hash) || typeof query.revision !== 'string' || !/^\d+$/.test(query.revision) || !Number.isSafeInteger(Number(query.revision)) || Number(query.revision) < 1) throw createError({ statusCode: 400 })
  return { uid: query.uid, kind: query.kind as 'employment' | 'offboarding', revision: Number(query.revision), hash: query.hash }
}
