<script setup lang="ts">
definePageMeta({ layoutHeader: true, layoutHeaderTitle: '跨应用操作', layoutHeaderProjectSwitcher: false })
const { loadAuthorization, getAuthorization } = useAuthorization()
const canReplay = ref(false)
onMounted(async () => {
  await loadAuthorization()
  canReplay.value = (getAuthorization()?.resources.integration_operations || []).includes('replay')
})
</script>

<template>
  <IntegrationOperationAdminPage source-app="aims" title="Aims 跨应用操作" :can-replay="canReplay" />
</template>
