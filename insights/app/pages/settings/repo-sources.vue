<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import { h, ref, onMounted } from 'vue'

const { apiBase } = useApiBase()
const toast = useToast()

const UButton = resolveComponent('UButton')
const USwitch = resolveComponent('USwitch')
const UBadge = resolveComponent('UBadge')

interface RepoSource {
  id: number
  sourceName: string
  sourceType: string
  baseUrl?: string
  reposBase?: string
  credentialRef?: string
  isActive: boolean
  lastSyncedAt?: string
}

const sources = ref<RepoSource[]>([])
const loading = ref(false)

async function loadSources() {
  loading.value = true
  try {
    const result = await $fetch<{ data: RepoSource[] }>(`${apiBase}/settings/repo-sources`)
    sources.value = result.data ?? []
  } catch (error: any) {
    toast.add({ title: '加载失败', description: error.message, color: 'error' })
  } finally {
    loading.value = false
  }
}

const modalOpen = ref(false)
const editing = ref<RepoSource | null>(null)
const form = ref({ sourceName: '', sourceType: 'gitlab', reposBase: '', credentialRef: 'GITLAB_TOKEN', isActive: true })

const sourceTypes = [{ label: 'GitLab', value: 'gitlab' }, { label: 'SVN', value: 'svn' }]

function openCreate() {
  editing.value = null
  form.value = { sourceName: '', sourceType: 'gitlab', reposBase: '', credentialRef: 'GITLAB_TOKEN', isActive: true }
  modalOpen.value = true
}

function openEdit(source: RepoSource) {
  editing.value = source
  form.value = { sourceName: source.sourceName, sourceType: source.sourceType, reposBase: source.reposBase || source.baseUrl || '', credentialRef: source.credentialRef || 'GITLAB_TOKEN', isActive: source.isActive }
  modalOpen.value = true
}

async function save() {
  try {
    if (editing.value) {
      await ($fetch as any)(`${apiBase}/settings/repo-sources/${editing.value.id}`, { method: 'PUT', body: form.value })
    } else {
      await ($fetch as any)(`${apiBase}/settings/repo-sources`, { method: 'POST', body: form.value })
    }
    modalOpen.value = false
    toast.add({ title: '保存成功', color: 'success' })
    await loadSources()
  } catch (error: any) {
    toast.add({ title: '保存失败', description: error.message, color: 'error' })
  }
}

async function toggleActive(source: RepoSource, value: boolean) {
  try {
    await ($fetch as any)(`${apiBase}/settings/repo-sources/${source.id}`, { method: 'PUT', body: { isActive: value } })
    source.isActive = value
  } catch (error: any) {
    toast.add({ title: '更新失败', description: error.message, color: 'error' })
  }
}

const formatDate = (dateStr?: string | null) => dateStr ? dateStr.replace('T', ' ').substring(0, 16) : '-'

const columns: TableColumn<RepoSource>[] = [
  { accessorKey: 'id', header: 'ID' },
  { accessorKey: 'sourceName', header: '名称' },
  { accessorKey: 'sourceType', header: '类型', cell: ({ row }) => h(UBadge, { variant: 'soft', color: row.original.sourceType === 'gitlab' ? 'primary' : 'secondary' }, () => row.original.sourceType.toUpperCase()) },
  { accessorKey: 'reposBase', header: 'URL', cell: ({ row }) => row.original.reposBase || '-' },
  { accessorKey: 'lastSyncedAt', header: '上次同步', cell: ({ row }) => formatDate(row.original.lastSyncedAt) },
  { accessorKey: 'isActive', header: '启用', cell: ({ row }) => h(USwitch, { 'modelValue': row.original.isActive, 'size': 'xs', 'onUpdate:modelValue': (v: boolean) => toggleActive(row.original, v) }) },
  { id: 'actions', header: '操作', cell: ({ row }) => h(UButton, { icon: 'i-lucide-pencil', size: 'xs', variant: 'ghost', onClick: () => openEdit(row.original) }) }
]

onMounted(() => loadSources())
</script>

<template>
  <UDashboardPanel grow>
    <UDashboardNavbar title="仓库源配置">
      <template #leading>
        <UDashboardSidebarCollapse />
      </template>
      <template #right>
        <UButton
          icon="i-lucide-plus"
          label="新建仓库源"
          size="sm"
          @click="openCreate"
        />
        <UButton
          icon="i-lucide-refresh-cw"
          variant="ghost"
          size="sm"
          :loading="loading"
          @click="loadSources"
        />
      </template>
    </UDashboardNavbar>

    <div class="p-4">
      <UCard :ui="{ body: 'p-0' }">
        <UTable
          :columns="columns"
          :data="sources"
          :loading="loading"
        />
        <div
          v-if="!loading && sources.length === 0"
          class="py-10 text-center text-muted-500"
        >
          暂无仓库源
        </div>
      </UCard>
    </div>

    <UModal
      v-model:open="modalOpen"
      :title="editing ? '编辑仓库源' : '新建仓库源'"
      :ui="{ content: 'sm:max-w-xl' }"
    >
      <template #body>
        <div class="space-y-4">
          <UFormField
            label="名称"
            required
          >
            <UInput v-model="form.sourceName" />
          </UFormField>
          <UFormField label="类型">
            <USelect
              v-model="form.sourceType"
              :items="sourceTypes"
              value-key="value"
              label-key="label"
            />
          </UFormField>
          <UFormField label="Base URL">
            <UInput
              v-model="form.reposBase"
              placeholder="https://gitlab.example.com"
            />
          </UFormField>
          <UFormField label="凭据引用">
            <UInput
              v-model="form.credentialRef"
              placeholder="GITLAB_TOKEN"
            />
          </UFormField>
          <UFormField label="启用">
            <USwitch v-model="form.isActive" />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton
            label="取消"
            variant="ghost"
            @click="modalOpen = false"
          />
          <UButton
            label="保存"
            @click="save"
          />
        </div>
      </template>
    </UModal>
  </UDashboardPanel>
</template>
