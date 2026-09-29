// Component-local state: preserve the key after transport/storage errors, but
// never reuse it for a changed payload or a different Host session scope.
export function createCreationAttempt(newKey = () => crypto.randomUUID()) {
  let pending
  return {
    keyFor(scope, payload) {
      const fingerprint = JSON.stringify([scope, Object.keys(payload).sort().map(key => [key, payload[key]])])
      if (!pending || pending.fingerprint !== fingerprint) pending = { fingerprint, key: newKey() }
      return pending.key
    },
    complete(key) {
      if (pending?.key === key) pending = undefined
    }
  }
}

export async function fingerprintUploadFiles(files) {
  return Promise.all(files.map(async file => {
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
    const hash = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('')
    return [file.name, file.size, hash]
  }))
}
