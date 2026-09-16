export function getPythonBackendUrl(): string {
  const config = useRuntimeConfig()
  return config.pythonBackendUrl || 'http://localhost:8000'
}
