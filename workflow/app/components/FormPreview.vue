<template>
  <div class="space-y-5">
    <div v-if="fields.length === 0" class="flex flex-col items-center justify-center py-12">
      <UIcon name="i-lucide-eye-off" class="text-4xl text-gray-300 mb-2" />
      <p class="text-sm text-muted">
        {{ emptyText }}
      </p>
    </div>
    <template v-else>
      <h3 v-if="title" class="text-lg font-semibold text-default border-b pb-2 mb-4">
        {{ title }}
      </h3>
      <div v-for="field in fields" :key="field.key">
        <!-- text -->
        <UFormField
          v-if="field.type === 'text'"
          :label="field.label"
          :required="field.required"
          :help="field.help_text"
        >
          <UInput
            :placeholder="field.placeholder || `请输入${field.label}`"
            :disabled="field.readonly"
            :maxlength="field.max_length"
            :model-value="field.default_value as string || ''"
            class="w-full"
          />
        </UFormField>

        <!-- textarea -->
        <UFormField
          v-else-if="field.type === 'textarea'"
          :label="field.label"
          :required="field.required"
          :help="field.help_text"
        >
          <UTextarea
            :placeholder="field.placeholder || `请输入${field.label}`"
            :disabled="field.readonly"
            :rows="field.rows || 3"
            :maxlength="field.max_length"
            :model-value="field.default_value as string || ''"
            class="w-full"
          />
        </UFormField>

        <!-- number -->
        <UFormField
          v-else-if="field.type === 'number'"
          :label="field.label"
          :required="field.required"
          :help="field.help_text"
        >
          <UInput
            type="number"
            :placeholder="field.placeholder || `请输入${field.label}`"
            :disabled="field.readonly"
            :model-value="field.default_value as string || ''"
            class="w-full"
          />
        </UFormField>

        <!-- select -->
        <UFormField
          v-else-if="field.type === 'select'"
          :label="field.label"
          :required="field.required"
          :help="field.help_text"
        >
          <USelect
            :placeholder="`请选择${field.label}`"
            :disabled="field.readonly"
            :items="(field.options || []).map(o => ({ label: o.label, value: o.value }))"
            :model-value="field.default_value as string || ''"
            class="w-full"
          />
        </UFormField>

        <!-- date -->
        <UFormField
          v-else-if="field.type === 'date'"
          :label="field.label"
          :required="field.required"
          :help="field.help_text"
        >
          <UInput
            type="date"
            :placeholder="field.placeholder || `请选择${field.label}`"
            :disabled="field.readonly"
            class="w-full"
          />
        </UFormField>

        <!-- user_picker -->
        <UFormField
          v-else-if="field.type === 'user_picker'"
          :label="field.label"
          :required="field.required"
          :help="field.help_text"
        >
          <UInput
            icon="i-lucide-user"
            :placeholder="`请选择${field.label}`"
            disabled
            class="w-full"
          />
        </UFormField>

        <!-- dept_picker -->
        <UFormField
          v-else-if="field.type === 'dept_picker'"
          :label="field.label"
          :required="field.required"
          :help="field.help_text"
        >
          <UInput
            icon="i-lucide-building-2"
            :placeholder="`请选择${field.label}`"
            disabled
            class="w-full"
          />
        </UFormField>

        <!-- file -->
        <UFormField
          v-else-if="field.type === 'file'"
          :label="field.label"
          :required="field.required"
          :help="field.help_text"
        >
          <div class="flex items-center gap-2">
            <UButton
              icon="i-lucide-upload"
              color="neutral"
              variant="outline"
              disabled
            >
              选择文件
            </UButton>
            <span class="text-sm text-muted">{{ field.accept || '支持所有格式' }}</span>
          </div>
        </UFormField>

        <!-- rich_text -->
        <UFormField
          v-else-if="field.type === 'rich_text'"
          :label="field.label"
          :required="field.required"
          :help="field.help_text"
        >
          <div class="border rounded-md p-3 min-h-[100px] bg-white dark:bg-gray-800 text-sm text-muted">
            富文本编辑器区域
          </div>
        </UFormField>

        <!-- 未知类型 -->
        <UFormField
          v-else
          :label="field.label"
          :required="field.required"
        >
          <div class="text-sm text-warning">
            不支持的字段类型: {{ field.type }}
          </div>
        </UFormField>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import type { FormField } from '~/types/workflow'

withDefaults(defineProps<{
  fields: FormField[]
  title?: string
  emptyText?: string
}>(), {
  title: '',
  emptyText: '请先在 JSON 编辑器中定义字段'
})
</script>
