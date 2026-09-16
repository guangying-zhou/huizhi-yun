import type { Ref } from 'vue'
import type { Uploader } from '@milkdown/plugin-upload'

interface UseEditorImageUploadOptions {
  editorRef: Ref<HTMLDivElement | null>
  documentId: Ref<string | undefined>
}

const uploadEditorImageFile = async (file: File, documentId?: string) => {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('documentId', documentId || '')

  const response = await fetch('/api/upload/image', {
    method: 'POST',
    body: formData
  })

  const result = await response.json()
  if (!response.ok || !result.success) {
    throw new Error(result.message || '上传失败')
  }

  return String(result.url || '')
}

export const useEditorImageUpload = ({
  editorRef,
  documentId
}: UseEditorImageUploadOptions) => {
  const onUpload = async (file: File) => {
    const imageBlock = editorRef.value?.querySelector('.milkdown-image-block .image-edit')
    const uploaderLabel = imageBlock?.querySelector('.uploader')
    const placeholderText = imageBlock?.querySelector('.placeholder .text')
    const imageIcon = imageBlock?.querySelector('.image-icon')

    const origUploaderHtml = uploaderLabel?.innerHTML || ''
    const origPlaceholderText = placeholderText?.textContent || ''
    const origIconHtml = imageIcon?.innerHTML || ''

    if (imageIcon) {
      imageIcon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="animate-spin"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/></svg>'
    }
    if (uploaderLabel) {
      uploaderLabel.textContent = '图片上传中……'
    }
    if (placeholderText) {
      placeholderText.textContent = ''
    }

    try {
      return await uploadEditorImageFile(file, documentId.value)
    } catch (error) {
      if (imageIcon) imageIcon.innerHTML = origIconHtml
      if (uploaderLabel) uploaderLabel.innerHTML = origUploaderHtml
      if (placeholderText) placeholderText.textContent = origPlaceholderText
      throw error
    }
  }

  const uploader: Uploader = async (files, schema) => {
    const images: File[] = []

    for (let index = 0; index < files.length; index += 1) {
      const file = files.item(index)
      if (!file || !file.type.includes('image')) continue
      images.push(file)
    }

    const nodes = await Promise.all(images.map(async (file) => {
      try {
        const url = await uploadEditorImageFile(file, documentId.value)
        const imageType = schema.nodes.image
        if (!imageType) {
          return schema.text(`[图片上传成功但无法插入: ${file.name}]`)
        }

        return imageType.createAndFill({
          src: url,
          alt: '',
          title: ''
        })
      } catch (error: unknown) {
        console.error('[Paste Upload] Failed:', error)
        return schema.text(`[图片上传失败: ${file.name}]`)
      }
    }))

    return nodes.filter((node): node is NonNullable<typeof node> => node !== null)
  }

  return {
    onUpload,
    uploader
  }
}
