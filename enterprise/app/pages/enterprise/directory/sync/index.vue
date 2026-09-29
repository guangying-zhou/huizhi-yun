<script setup lang="ts">
definePageMeta({ hostContentInset: false, name: 'console-host-directory-sync', navigationOwner: 'console' })
</script>

<template>
  <DirectorySyncReadPage
    api-path="/enterprise/api/directory/sync-jobs"
    page-path="/enterprise/directory/sync"
    console-path="/console/directory/sync"
  />
</template>
