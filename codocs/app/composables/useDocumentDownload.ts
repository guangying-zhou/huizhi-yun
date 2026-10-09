import { useCodocsModule } from '../../layer/useCodocsModule'

export function useDocumentDownload() {
  const { moduleUrl } = useCodocsModule()
  const { resolveCurrentAppUrl } = useAppUrls()

  function buildDocumentDownloadUrl(uuid: string) {
    const normalizedUuid = String(uuid || '').trim()
    if (!normalizedUuid) return ''

    return resolveCurrentAppUrl(moduleUrl(`/api/documents/${encodeURIComponent(normalizedUuid)}/download`))
  }

  function downloadDocument(uuid: string) {
    const href = buildDocumentDownloadUrl(uuid)
    if (!href) return

    const link = document.createElement('a')
    link.href = href
    link.download = ''
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  return {
    buildDocumentDownloadUrl,
    downloadDocument
  }
}
