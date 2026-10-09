<script setup lang="ts">
defineProps<{ disabled?: boolean }>()
const emit = defineEmits<{ open: [path: string] }>()
const { loaded, error, hasPermission, loadPermissions } = usePermissions()
onMounted(() => void loadPermissions())
</script>

<template>
  <div
    v-if="loaded && !error"
    class="flex flex-wrap gap-2"
  >
    <UButton
      v-if="hasPermission('receipts', 'confirm')"
      :disabled="disabled"
      icon="i-lucide-plus"
      @click="emit('open', '/finance/receipts/new')"
    >
      登记到账
    </UButton>
    <UButton
      v-if="hasPermission('invoices', 'edit')"
      :disabled="disabled"
      color="neutral"
      variant="outline"
      @click="emit('open', '/finance/invoices/requests/new')"
    >
      申请开票
    </UButton>
  </div>
</template>
