<script setup lang="ts">
definePageMeta({ hostContentInset: false, name: 'console-host-directory-sync-detail', navigationOwner: 'console' })
const route = useRoute()
const jobCode = computed(() => String(route.params.jobCode || ''))
</script>

<template>
  <DirectorySyncReadPage
    :key="jobCode"
    api-path="/enterprise/api/directory/sync-jobs"
    page-path="/enterprise/directory/sync"
    console-path="/console/directory/sync"
    :job-code="jobCode"
  />
</template>
