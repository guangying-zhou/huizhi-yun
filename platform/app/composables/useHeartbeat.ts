export function useHeartbeat() {
  const lastHeartbeatAt = useState<string | null>('platform-console-last-heartbeat-at', () => null)

  function beat() {
    lastHeartbeatAt.value = new Date().toISOString()
  }

  if (import.meta.client) {
    onMounted(beat)
  }

  return {
    lastHeartbeatAt,
    beat
  }
}
