<script setup lang="ts">
type ConfirmColor = 'primary' | 'error' | 'warning' | 'success' | 'info' | 'neutral'

interface Props {
  title?: string
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  color?: ConfirmColor
  icon?: string
}

withDefaults(defineProps<Props>(), {
  title: '确认操作',
  message: '',
  confirmLabel: '确认',
  cancelLabel: '取消',
  color: 'primary',
  icon: ''
})

const emit = defineEmits<{ close: [boolean] }>()

const iconClass: Record<ConfirmColor, string> = {
  primary: 'text-primary',
  error: 'text-error',
  warning: 'text-warning',
  success: 'text-success',
  info: 'text-info',
  neutral: 'text-muted'
}
</script>

<template>
  <UModal
    :title="title"
    :description="message || title"
    :ui="{ content: 'max-w-md', description: 'sr-only' }"
  >
    <template #body>
      <div class="flex items-start gap-3">
        <UIcon
          v-if="icon"
          :name="icon"
          class="mt-0.5 size-5 shrink-0"
          :class="iconClass[color]"
        />
        <p class="whitespace-pre-line text-sm text-muted">
          {{ message }}
        </p>
      </div>
    </template>

    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton
          :label="cancelLabel"
          color="neutral"
          variant="ghost"
          @click="emit('close', false)"
        />
        <UButton
          :label="confirmLabel"
          :color="color"
          @click="emit('close', true)"
        />
      </div>
    </template>
  </UModal>
</template>
