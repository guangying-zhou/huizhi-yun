/**
 * OSS Client Utility
 *
 * Provides functions to download documents from OSS
 */

/**
 * Download document content from OSS
 * @param ossPath - The OSS path of the document
 * @param docType - The document type (private, department, project, company, etc.)
 * @returns The document content as string
 */
export async function downloadDocument(
  ossPath: string,
  docType: string
): Promise<string> {
  try {
    // Use the backend API to download the document
    // The backend will handle OSS authentication and bucket selection
    const response = await $fetch<{ success: boolean, content: string }>(
      '/api/documents/download-content',
      {
        method: 'POST',
        body: {
          oss_path: ossPath,
          doc_type: docType
        }
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
