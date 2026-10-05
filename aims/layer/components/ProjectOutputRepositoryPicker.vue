<script setup lang="ts">
import { useAimsModule } from '../useAimsModule'
import { useProjectStore } from '../../app/stores/project'

const props = defineProps<{ projectId: string, linkedCodes: string[] }>()
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ linked: [] }>()
const { moduleUrl } = useAimsModule()
const store = useProjectStore()
const items = ref<{ projectCode: string, name: string }[]>([])
const group = ref<string | null>(null)
const selected = ref<string[]>([])
const search = ref('')
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const filtered = computed(() => items.value.filter(item => `${item.name} ${item.projectCode}`.toLowerCase().includes(search.value.toLowerCase())))
let sequence = 0
watch([open, () => props.projectId], async () => {
  const request = ++sequence
  if (!open.value) return
  items.value = []
  selected.value = []
  search.value = ''
  error.value = ''
  loading.value = true
  try {
    const response = await $fetch<{ code: number, data: { gitGroup: string | null, items: { projectCode: string, name: string }[] } }>(moduleUrl(`/api/v1/projects/${props.projectId}/repo-candidates`))
    if (request !== sequence) return
    if (response.code !== 0 || !Array.isArray(response.data?.items)) throw new Error('仓库候选响应无效')
    items.value = response.data.items
    group.value = response.data.gitGroup
  } catch (cause) {
    if (request === sequence) error.value = cause instanceof Error ? cause.message : '仓库目录暂不可用'
  } finally {
    if (request === sequence) loading.value = false
  }
})
async function link() {
  if (saving.value || !selected.value.length) return
  saving.value = true
  error.value = ''
  try {
    // Each established link is its own idempotent command. A failed command
    // keeps the same intent key in the store; retry does not duplicate links.
    for (const code of [...selected.value]) {
      await store.linkRepo(Number(props.projectId), code)
      selected.value = selected.value.filter(value => value !== code)
    }
    emit('linked')
    open.value = false
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '关联失败，可重试剩余仓库'
    emit('linked')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    title="关联代码仓库"
    description="仅列出当前项目所属项目集的已登记 GitLab 组；服务端仍会复核项目编辑权限。"
    :dismissible="!saving"
  >
    <template #body>
      <div class="min-w-0 space-y-4">
        <UAlert
          v-if="error"
          color="error"
          title="仓库操作失败"
          :description="error"
        />
        <USkeleton v-if="loading" class="h-32" />
        <template v-else>
          <p class="break-all text-sm text-muted">
            {{ group || '当前项目尚未登记仓库组' }}
          </p>
          <UInput
            v-model="search"
            placeholder="搜索仓库名称或路径"
            aria-label="搜索仓库"
            class="w-full"
            :disabled="saving"
          />
          <div class="max-h-80 space-y-3 overflow-y-auto">
            <UCheckbox
              v-for="item in filtered"
              :key="item.projectCode"
              :model-value="selected.includes(item.projectCode)"
              :disabled="saving || linkedCodes.includes(item.projectCode)"
              :label="`${item.name} · ${item.projectCode}${linkedCodes.includes(item.projectCode) ? '（已关联）' : ''}`"
              :ui="{ label: 'whitespace-normal break-all' }"
              @update:model-value="value => selected = value ? [...selected, item.projectCode] : selected.filter(code => code !== item.projectCode)"
            />
            <p v-if="!filtered.length" class="text-sm text-muted">
              没有可选仓库
            </p>
          </div>
        </template>
      </div>
    </template>
    <template #footer>
      <UButton :loading="saving" :disabled="loading || !selected.length" @click="link">
        关联选中仓库
      </UButton><UButton
        color="neutral"
        variant="ghost"
        :disabled="saving"
        @click="open = false"
      >
        取消
      </UButton>
    </template>
  </UModal>
</template>
