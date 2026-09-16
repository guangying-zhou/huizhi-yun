<script setup lang="ts">
const { loadAuthorization, getAuthorization } = useAuthorization()
const canReplay = ref(false)
onMounted(async () => {
  await loadAuthorization()
  canReplay.value = (getAuthorization()?.resources.integration_operations || []).includes('replay')
})
</script>

<template>
  <IntegrationOperationAdminPage source-app="altoc" title="Altoc 跨应用操作" :can-replay="canReplay" />
</template>
