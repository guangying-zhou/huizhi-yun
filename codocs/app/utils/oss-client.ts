/**
 * OSS Client Utility
 *
 * Provides functions to download documents from OSS
 */

/**
 * Download document content from OSS
 * @param ossPath - The OSS path of the document
 * @param docType - The document type (private, department, project, company, etc.)
 * @param options - The document identity used by the backend to bind OSS paths to facts
 * @returns The document content as string
 */
export interface DownloadDocumentOptions {
  documentUuid?: string
  projectCode?: string
}

export async function downloadDocument(
  ossPath: string,
  docType: string,
  options: DownloadDocumentOptions = {}
): Promise<string> {
  try {
    const normalizedDocType = String(docType || '').trim()
    const body: Record<string, string> = {
      oss_path: ossPath,
      doc_type: normalizedDocType
    }

    if (normalizedDocType === 'git-project') {
      if (!options.projectCode) {
        throw new Error('projectCode is required to download git project document content')
      }
      body.project_code = options.projectCode
    } else {
      if (!options.documentUuid) {
        throw new Error('documentUuid is required to download document content')
      }
      body.document_uuid = options.documentUuid
    }

    // Use the backend API to download the document
    // The backend will handle OSS authentication and bucket selection
    const response = await $fetch<{ success: boolean, content: string }>(
      '/api/documents/download-content',
      {
        method: 'POST',
        body
      }
    )

    if (response.success && response.content) {
      return response.content
    }

    throw new Error('Failed to download document content')
  } catch (error) {
    console.error('Error downloading document:', error)
    throw error
  }
}
