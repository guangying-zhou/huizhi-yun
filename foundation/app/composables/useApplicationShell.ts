function embedQueryEnabled(value: unknown) {
  if (Array.isArray(value)) {
    return value.some(item => String(item || '').trim() === '1')
  }
  return String(value || '').trim() === '1'
}

export function useApplicationShell() {
  const route = useRoute()
  const framedByApplicationShell = import.meta.client && window.parent !== window
  const embedded = useState<boolean>('hzy-application-shell-embedded', () => (
    framedByApplicationShell || embedQueryEnabled(route.query[APPLICATION_SHELL_EMBED_QUERY])
  ))

  // Client-side navigation may intentionally omit the private hzy_embed query.
  // The actual frame boundary remains authoritative for the whole app session.
  if (framedByApplicationShell || embedQueryEnabled(route.query[APPLICATION_SHELL_EMBED_QUERY])) {
    embedded.value = true
  }

  return {
    embedded
  }
}
