<script setup lang="ts">
/**
 * 文档关联面板 — 可在任何实体详情页中复用
 * 支持创建新文档（调用 Codocs）和查看已关联文档
 */
const props = defineProps<{
  entityType: string // opportunity / contract / quotation / customer
  entityId: number
}>()

const toast = useToast()
const config = useRuntimeConfig()
const codocsUrl = String(config.public.codocsBaseUrl || 'http://localhost:3001')

interface DocumentLink {
  id: number
  entity_type: string
  entity_id: number
  document_uuid?: string | null
  external_url?: string | null
  document_title?: string | null
  link_type?: string | null
  created_at?: string | null
}

interface DocumentsResponse {
  data?: DocumentLink[] | { items?: DocumentLink[] }
}

interface CreateDocumentResponse {
  data?: {
    document_uuid?: string
  }
}

interface ApiErrorLike {
  data?: {
    statusMessage?: string
  }
  message?: string
}

const LINK_TYPE_LABELS: Record<string, string> = {
  general: '通用文档',
  proposal: '方案文档',
  contract_text: '合同文本',
  legacy_contract_scan: '合同扫描件',
  meeting_memo: '会议纪要',
  tender_doc: '投标材料'
}

const linkTypeOptions = Object.entries(LINK_TYPE_LABELS).map(([v, l]) => ({ label: l, value: v }))

function linkTypeLabel(value: string | null | undefined) {
  return value ? LINK_TYPE_LABELS[value] || value : '-'
}

// 加载关联文档
const { data: docs, refresh } = useFetch('/api/v1/documents', {
  query: computed(() => ({ entity_type: props.entityType, entity_id: props.entityId, page_size: 100 })),
  transform: (res: DocumentsResponse) => {
    const data = res?.data
    if (Array.isArray(data)) return data
    if (Array.isArray(data?.items)) return data.items
    return []
  }
})

// 新建文档弹窗
const showCreateModal = ref(false)
const createLoading = ref(false)
const createForm = reactive({
  title: '',
  link_type: 'general',
  content: ''
})

async function createDocument() {
  if (!createForm.title.trim()) {
    toast.add({ title: '请输入文档标题', color: 'error' })
    return
  }
  createLoading.value = true
  try {
    const res = await $fetch<CreateDocumentResponse>('/api/v1/documents', {
      method: 'POST',
      body: {
        entity_type: props.entityType,
        entity_id: props.entityId,
        title: createForm.title,
        link_type: createForm.link_type,
        content: createForm.content || `# ${createForm.title}\n\n`
      }
    })
    toast.add({ title: '文档创建成功', color: 'success' })
    showCreateModal.value = false
    createForm.title = ''
    createForm.link_type = 'general'
    createForm.content = ''
    refresh()
    // 自动打开文档
    if (res.data?.document_uuid) {
      window.open(`${codocsUrl}/documents/${res.data.document_uuid}`, '_blank')
    }
  } catch (err: unknown) {
    toast.add({ title: apiErrorMessage(err) || '创建失败', color: 'error' })
  } finally {
    createLoading.value = false
  }
}

// 删除关联
async function removeLink(doc: DocumentLink) {
  if (!confirm('确定取消关联？（不会删除 Codocs 中的文档）')) return
  try {
    await $fetch(`/api/v1/documents/${doc.id}`, {
      method: 'DELETE',
      query: {
        entity_type: doc.entity_type,
        entity_id: doc.entity_id
      }
    })
    toast.add({ title: '已取消关联', color: 'success' })
    refresh()
  } catch {
    toast.add({ title: '操作失败', color: 'error' })
  }
}

// 预览文档
const previewOpen = ref(false)
const previewUuid = ref('')
const previewTitle = ref('')
const externalPreviewOpen = ref(false)
const externalPreviewUrl = ref('')
const externalPreviewTitle = ref('')

function openExternalUrl(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer')
}

function openDocument(doc: DocumentLink) {
  const externalUrl = String(doc?.external_url || '').trim()
  if (externalUrl) {
    externalPreviewUrl.value = externalUrl
    externalPreviewTitle.value = doc.document_title || '外部文档'
    externalPreviewOpen.value = true
    return
  }

  if (!doc?.document_uuid) {
    toast.add({ title: '文档链接缺少可预览地址', color: 'warning' })
    return
  }

  previewUuid.value = doc.document_uuid
  previewTitle.value = doc.document_title || '关联文档'
  previewOpen.value = true
}

function apiErrorMessage(error: unknown) {
  if (error && typeof error === 'object') {
    const apiError = error as ApiErrorLike
    return apiError.data?.statusMessage || apiError.message || ''
  }
  return ''
}
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-center justify-between">
        <span class="font-semibold text-sm">关联文档 ({{ docs?.length || 0 }})</span>
        <UButton
          label="新建文档"
          icon="i-lucide-file-plus"
          size="sm"
          variant="soft"
          @click="showCreateModal = true"
        />
      </div>
    </template>

    <div v-if="docs?.length" class="divide-y divide-default">
      <div
        v-for="doc in docs"
        :key="doc.id"
        class="flex items-center justify-between py-2.5 -mx-4 px-4 hover:bg-elevated/50 transition-colors"
      >
        <div class="flex items-center gap-2 min-w-0 flex-1 cursor-pointer" @click="openDocument(doc)">
          <UIcon :name="doc.external_url ? 'i-lucide-file-type' : 'i-lucide-file-text'" class="text-primary shrink-0" />
          <div class="min-w-0">
            <div class="text-sm font-medium truncate text-primary hover:underline">
              {{ doc.document_title }}
            </div>
            <div class="flex items-center gap-2 text-xs text-muted">
              <UBadge color="neutral" variant="subtle" size="xs">
                {{ linkTypeLabel(doc.link_type) }}
              </UBadge>
              <UBadge
                v-if="doc.external_url"
                color="warning"
                variant="subtle"
                size="xs"
              >
                外部PDF
              </UBadge>
              <span>{{ doc.created_at }}</span>
            </div>
          </div>
        </div>
        <div class="flex items-center gap-1 shrink-0">
          <UButton
            v-if="doc.external_url"
            icon="i-lucide-external-link"
            variant="ghost"
            color="neutral"
            size="xs"
            title="新窗口打开"
            @click.stop="openExternalUrl(doc.external_url)"
          />
          <UButton
            icon="i-lucide-unlink"
            variant="ghost"
            color="neutral"
            size="xs"
            title="取消关联"
            @click="removeLink(doc)"
          />
        </div>
      </div>
    </div>
    <div v-else class="text-center py-6 text-muted text-sm">
      <p>暂无关联文档</p>
      <p class="text-xs mt-1">
        点击"新建文档"在 Codocs 中创建并关联
      </p>
    </div>
  </UCard>

  <!-- 新建文档弹窗 -->
  <UModal v-model:open="showCreateModal" title="新建关联文档">
    <template #content>
      <UCard>
        <template #header>
          <div class="flex items-center justify-between">
            <span class="font-semibold">新建关联文档</span>
            <UButton
              icon="i-lucide-x"
              variant="ghost"
              color="neutral"
              size="xs"
              @click="showCreateModal = false"
            />
          </div>
        </template>
        <div class="space-y-4">
          <UFormField label="文档标题" required>
            <UInput v-model="createForm.title" placeholder="如：XX项目方案文档" class="w-full" />
          </UFormField>
          <UFormField label="文档类型">
            <USelect v-model="createForm.link_type" :items="linkTypeOptions" class="w-full" />
          </UFormField>
        </div>
        <template #footer>
          <div class="flex justify-end gap-2">
            <UButton
              label="取消"
              variant="ghost"
              color="neutral"
              @click="showCreateModal = false"
            />
            <UButton
              label="创建并打开"
              color="primary"
              icon="i-lucide-external-link"
              :loading="createLoading"
              @click="createDocument"
            />
          </div>
        </template>
      </UCard>
    </template>
  </UModal>

  <!-- 文档预览弹窗 -->
  <DocumentPreview v-model:open="previewOpen" :uuid="previewUuid" :title="previewTitle" />

  <!-- 外部PDF预览弹窗 -->
  <UModal v-model:open="externalPreviewOpen" :title="externalPreviewTitle" :ui="{ content: 'sm:max-w-6xl' }">
    <template #content>
      <UCard>
        <template #header>
          <div class="flex items-center justify-between gap-3">
            <span class="font-semibold truncate">{{ externalPreviewTitle }}</span>
            <div class="flex items-center gap-1 shrink-0">
              <UButton
                icon="i-lucide-external-link"
                variant="ghost"
                color="neutral"
                size="xs"
                title="新窗口打开"
                @click="openExternalUrl(externalPreviewUrl)"
              />
              <UButton
                icon="i-lucide-x"
                variant="ghost"
                color="neutral"
                size="xs"
                @click="externalPreviewOpen = false"
              />
            </div>
          </div>
        </template>
        <iframe
          v-if="externalPreviewUrl"
          :src="externalPreviewUrl"
          class="h-[75vh] w-full rounded border border-default bg-white"
          :title="externalPreviewTitle"
        />
      </UCard>
    </template>
  </UModal>
</template>
