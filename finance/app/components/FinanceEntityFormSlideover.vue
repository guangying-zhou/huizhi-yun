<script setup lang="ts">
import type { CreateField } from '~/config/pageConfigs'

const props = defineProps<{
  title: string
  description?: string
  fields: CreateField[]
  pending?: boolean
  error?: string
  editing?: boolean
  getFieldOptions: (field: CreateField) => Array<{ label: string, value: string }>
  getSelectedFileName: (field: CreateField) => string
}>()

const emit = defineEmits<{
  cancel: []
  submit: []
  fileChange: [field: CreateField, event: Event]
}>()

const open = defineModel<boolean>('open', { default: false })
const form = defineModel<Record<string, string>>('form', { required: true })

function close() {
  open.value = false
  emit('cancel')
}
</script>

<template>
  <USlideover
    v-model:open="open"
    side="right"
    :title="`${editing ? '编辑' : '新建'}${title}`"
    :description="description"
    :ui="{ content: 'sm:max-w-3xl', body: 'space-y-4' }"
  >
    <template #body>
      <div class="grid gap-4 md:grid-cols-2">
        <UFormField
          v-for="field in fields"
          :key="field.key"
          :label="field.label"
          :required="field.required"
        >
          <USelect
            v-if="field.type === 'select'"
            v-model="form[field.key]"
            :items="props.getFieldOptions(field)"
            value-key="value"
            label-key="label"
            :placeholder="field.placeholder || field.label"
            :disabled="field.readonly"
            class="w-full"
          />
          <div
            v-else-if="field.type === 'file'"
            class="space-y-1"
          >
            <UInput
              type="file"
              :accept="field.accept"
              :disabled="field.readonly"
              @change="emit('fileChange', field, $event)"
            />
            <p
              v-if="props.getSelectedFileName(field)"
              class="truncate text-xs text-muted"
            >
              {{ props.getSelectedFileName(field) }}
            </p>
          </div>
          <UInput
            v-else
            v-model="form[field.key]"
            :type="field.type || 'text'"
            :placeholder="field.placeholder || field.label"
            :disabled="field.readonly || (editing && field.key === 'code')"
            class="w-full"
          />
        </UFormField>
      </div>

      <UAlert
        v-if="error"
        color="error"
        variant="subtle"
        icon="i-lucide-circle-alert"
        :title="error"
      />
    </template>

    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton
          color="neutral"
          variant="ghost"
          @click="close"
        >
          取消
        </UButton>
        <UButton
          icon="i-lucide-save"
          :loading="pending"
          @click="emit('submit')"
        >
          {{ editing ? '更新' : '保存' }}
        </UButton>
      </div>
    </template>
  </USlideover>
</template>
