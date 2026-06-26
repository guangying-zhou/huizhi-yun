<script setup lang="ts">
interface RestoreDocRecord {
  uuid: string
  title: string
  doc_type: string
  owner_uid?: string
  folder_id?: number | null
  dept_code?: string
  project_code?: string
}

const props = defineProps<{
  open: boolean
  doc: RestoreDocRecord | null // 要恢复的文档对象
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'restored': []
}>()

const { generateConflictName, checkNameConflict, restoreDocument } = useRecycleBin()

const isRestoring = ref(false)
const hasConflict = ref(false)
const newTitle = ref('')
const checking = ref(false)

// 当弹窗打开时检查冲突
watch(() => props.open, async (isOpen) => {
  if (isOpen && props.doc) {
    hasConflict.value = false
    newTitle.value = props.doc.title
    checking.value = true

    const conflict = await checkNameConflict({
      title: props.doc.title,
      doc_type: props.doc.doc_type,
      owner_uid: props.doc.owner_uid,
      folder_id: props.doc.folder_id,
      dept_code: props.doc.dept_code,
      project_code: props.doc.project_code,
      exclude_uuid: props.doc.uuid
    })

    if (conflict) {
      hasConflict.value = true
      newTitle.value = generateConflictName(props.doc.title)
    }

    checking.value = false
  }
})

const doRestore = async () => {
  if (!props.doc) return

  isRestoring.value = true
  try {
    const titleToUse = hasConflict.value ? newTitle.value.trim() : undefined

    // 如果修改了标题，再次检查新标题是否冲突
    if (titleToUse) {
      const stillConflict = await checkNameConflict({
        title: titleToUse,
        doc_type: props.doc.doc_type,
        owner_uid: props.doc.owner_uid,
        folder_id: props.doc.folder_id,
        dept_code: props.doc.dept_code,
        project_code: props.doc.project_code,
        exclude_uuid: props.doc.uuid
      })
      if (stillConflict) {
        const toast = useToast()
        toast.add({ title: '新文件名仍然存在冲突，请修改', color: 'warning' })
        isRestoring.value = false
        return
      }
    }

    const success = await restoreDocument(props.doc.uuid, titleToUse)
    if (success) {
      emit('update:open', false)
      emit('restored')
    }
  } finally {
    isRestoring.value = false
  }
}

const close = () => {
  emit('update:open', false)
}
</script>

<template>
  <UModal :open="open" @update:open="emit('update:open', $event)">
    <template #content>
      <UCard>
        <template #header>
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-archive-restore" class="w-5 h-5 text-primary" />
              <h3 class="text-lg font-semibold">
                恢复文档
              </h3>
            </div>
            <UButton
              icon="i-lucide-x"
              color="neutral"
              variant="ghost"
              @click="close"
            />
          </div>
        </template>

        <div v-if="checking" class="flex items-center gap-2 py-4">
          <UIcon name="i-lucide-loader-2" class="w-4 h-4 animate-spin" />
          <span class="text-sm text-muted">检查文件名冲突...</span>
        </div>

        <div v-else class="space-y-3">
          <p v-if="!hasConflict" class="text-muted">
            确定要恢复文档 <strong class="text-default">"{{ doc?.title }}"</strong> 到原文件夹吗？
          </p>

          <template v-else>
            <p class="text-muted">
              原文件夹中已存在同名文档 <strong class="text-default">"{{ doc?.title }}"</strong>，请修改文件名：
            </p>
            <UFormField label="新文件名">
              <UInput
                v-model="newTitle"
                placeholder="请输入新文件名"
                autofocus
                @keyup.enter="doRestore"
              />
            </UFormField>
          </template>
        </div>

        <template #footer>
          <div class="flex justify-end gap-2">
            <UButton color="neutral" variant="outline" @click="close">
              取消
            </UButton>
            <UButton
              color="primary"
              :loading="isRestoring"
              :disabled="checking || (hasConflict && !newTitle.trim())"
              @click="doRestore"
            >
              恢复
            </UButton>
          </div>
        </template>
      </UCard>
    </template>
  </UModal>
</template>
