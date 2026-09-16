<script setup lang="ts">
interface ContentNode {
  id: number
  parentId: number | null
  headingDepth: number
  title: string
  requirementId: number | null
}

interface ModuleOption {
  value: number
  label: string
}

const props = defineProps<{
  projectId: number
  headingLevels?: string | null
  contents: ContentNode[]
  selectedContentId?: number | null
  defaultMilestoneId?: number | null
}>()

const emit = defineEmits<{
  close: []
  created: []
}>()

const toast = useToast()
const open = ref(true)
const submitting = ref(false)
const createKind = ref<'item' | 'module'>('item')

function parseHeadingLevels(raw: string | null | undefined) {
  const parts = String(raw || '2,3')
    .split(',')
    .map(v => Number(v.trim()))
    .filter(v => Number.isInteger(v) && v >= 2 && v <= 6)
  if (parts.length >= 2) {
    return { moduleDepth: parts[0]!, itemDepth: parts[1]! }
  }
  return { moduleDepth: 2, itemDepth: 3 }
}

const headingConfig = computed(() => parseHeadingLevels(props.headingLevels))
const moduleDepth = computed(() => headingConfig.value.moduleDepth)
const itemDepth = computed(() => headingConfig.value.itemDepth)
const categoryDepth = computed(() => Math.max(1, moduleDepth.value - 1))

const contentMap = computed(() => {
  const map = new Map<number, ContentNode>()
  for (const content of props.contents) {
    map.set(content.id, content)
  }
  return map
})

function getContent(id: number | null | undefined) {
  if (!id) return null
  return contentMap.value.get(id) || null
}

function findAncestorByDepth(nodeId: number | null | undefined, depth: number): ContentNode | null {
  let current = getContent(nodeId)
  while (current) {
    if (current.headingDepth === depth) return current
    current = getContent(current.parentId)
  }
  return null
}

function findFirstChildModule(nodeId: number | null | undefined) {
  if (!nodeId) return null
  return props.contents.find(content => content.parentId === nodeId && content.headingDepth === moduleDepth.value) || null
}

const selectedNode = computed(() => getContent(props.selectedContentId))
const selectedModule = computed(() => {
  if (!selectedNode.value) return null
  if (selectedNode.value.headingDepth === moduleDepth.value) return selectedNode.value
  if (moduleDepth.value > 2 && selectedNode.value.headingDepth === categoryDepth.value) {
    return findFirstChildModule(selectedNode.value.id)
  }
  return findAncestorByDepth(selectedNode.value.parentId, moduleDepth.value)
})

const selectedCategory = computed(() => {
  if (!selectedNode.value || moduleDepth.value <= 2) return null
  if (selectedNode.value.headingDepth === categoryDepth.value) return selectedNode.value
  return findAncestorByDepth(selectedNode.value.id, categoryDepth.value)
})

const moduleOptions = computed<ModuleOption[]>(() => {
  return props.contents
    .filter(content => content.headingDepth === moduleDepth.value)
    .map((content) => {
      const parent = getContent(content.parentId)
      return {
        value: content.id,
        label: parent ? `${parent.title} / ${content.title}` : content.title
      }
    })
})

const selectedModuleId = ref<number | undefined>(undefined)

watch(selectedModule, (module) => {
  if (createKind.value !== 'item') return
  selectedModuleId.value = moduleOptions.value.find(option => option.value === module?.id)?.value || moduleOptions.value[0]?.value
}, { immediate: true })

watch(createKind, (kind) => {
  if (kind === 'item' && !selectedModuleId.value) {
    selectedModuleId.value = moduleOptions.value.find(option => option.value === selectedModule.value?.id)?.value || moduleOptions.value[0]?.value
  }
})

const form = reactive({
  title: '',
  contentMd: ''
})

const depthHint = computed(() => createKind.value === 'item' ? `H${itemDepth.value}` : `H${moduleDepth.value}`)

const canSubmit = computed(() => {
  if (!form.title.trim()) return false
  if (createKind.value === 'item' && !selectedModuleId.value) return false
  return true
})

function resolveModuleParentId() {
  if (moduleDepth.value <= 2) return null
  if (selectedCategory.value) return selectedCategory.value.id

  const fromSelectedModule = selectedModule.value ? getContent(selectedModule.value.parentId) : null
  if (fromSelectedModule && fromSelectedModule.headingDepth === categoryDepth.value) {
    return fromSelectedModule.id
  }

  const firstFunctionalCategory = props.contents.find(content =>
    content.headingDepth === categoryDepth.value
    && !/非功能/.test(content.title)
  )
  if (firstFunctionalCategory) return firstFunctionalCategory.id

  const firstCategory = props.contents.find(content => content.headingDepth === categoryDepth.value)
  return firstCategory?.id || null
}

async function handleSubmit() {
  if (!canSubmit.value || submitting.value) return
  submitting.value = true
  try {
    const parentId = createKind.value === 'item'
      ? selectedModuleId.value
      : resolveModuleParentId()

    const res = await $fetch<{ code: number, data: { title: string, childContentIds: number[] } }>(
      `/api/v1/projects/${props.projectId}/requirement-contents`,
      {
        method: 'POST',
        body: {
          kind: createKind.value,
          title: form.title.trim(),
          parentId,
          headingDepth: createKind.value === 'item' ? itemDepth.value : moduleDepth.value,
          contentMd: form.contentMd
        }
      }
    )
    if (res.code === 0) {
      const childMsg = res.data.childContentIds.length > 0 ? `，并拆分 ${res.data.childContentIds.length} 个功能项` : ''
      toast.add({ title: `已新增规格书内容：${res.data.title}${childMsg}`, color: 'success' })
      emit('created')
    }
  } catch (err: unknown) {
    const msg = (err as { data?: { message?: string } })?.data?.message
      || (err as { message?: string })?.message
      || '新增规格书内容失败'
    toast.add({ title: msg, color: 'error' })
  } finally {
    submitting.value = false
  }
}

watch(open, (value) => {
  if (!value) emit('close')
})
</script>

<template>
  <UModal
    v-model:open="open"
    :ui="{ content: 'sm:max-w-3xl' }"
  >
    <template #header>
      <div class="flex items-center gap-2">
        <UIcon name="i-lucide-plus" class="size-5 text-primary" />
        <span class="font-semibold">新增需求</span>
      </div>
    </template>

    <template #body>
      <div class="space-y-4">
        <UFormField label="新增类型">
          <URadioGroup
            v-model="createKind"
            :items="[
              { label: '新增功能项', value: 'item' },
              { label: '新增功能模块', value: 'module' }
            ]"
            orientation="horizontal"
          />
        </UFormField>

        <UFormField
          v-if="createKind === 'item'"
          label="所属功能模块"
          required
        >
          <USelectMenu
            v-model="selectedModuleId"
            :items="moduleOptions"
            value-key="value"
            label-key="label"
            class="w-full"
            placeholder="请选择功能模块"
          />
        </UFormField>

        <div class="rounded border border-default bg-elevated/30 px-3 py-2 text-xs text-muted">
          标题层级将按规格书模式保存为 {{ depthHint }}
        </div>

        <div
          v-if="createKind === 'module'"
          class="rounded border border-default bg-elevated/30 px-3 py-2 text-xs text-muted"
        >
          在正文中使用 Markdown 标题 <span class="font-mono">{{ '#'.repeat(itemDepth) }}</span> 可自动拆分成功能项；保存后不会自动创建需求项，需后续手动设为需求项。
        </div>

        <UFormField label="标题" required>
          <UInput
            v-model="form.title"
            class="w-full"
            :placeholder="createKind === 'item' ? '请输入功能项标题' : '请输入功能模块标题'"
          />
        </UFormField>

        <UFormField label="正文">
          <UTextarea
            v-model="form.contentMd"
            :rows="14"
            class="w-full font-mono text-sm"
            placeholder="请输入正文内容（Markdown）"
          />
        </UFormField>
      </div>
    </template>

    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton
          label="取消"
          color="neutral"
          variant="ghost"
          :disabled="submitting"
          @click="open = false"
        />
        <UButton
          label="创建"
          color="primary"
          :disabled="!canSubmit"
          :loading="submitting"
          @click="handleSubmit"
        />
      </div>
    </template>
  </UModal>
</template>
