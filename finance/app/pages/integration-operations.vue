<script setup lang="ts">
usePageTitle('跨应用操作')

const { loadAuthorization, getAuthorization } = useAuthorization()
const canReplay = ref(false)

onMounted(async () => {
  await loadAuthorization()
  canReplay.value = (getAuthorization()?.resources.integration_operations || []).includes('replay')
})
</script>

<template>
  <IntegrationOperationAdminPage
    source-app="finance"
    title="Finance 跨应用操作"
    api-base="/api/v1/finance/integration-operations"
    :can-replay="canReplay"
  />
</template>
