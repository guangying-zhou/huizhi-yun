<script setup lang="ts">
definePageMeta({ hostContentInset: false, name: 'console-host-directory-committees', navigationOwner: 'console' })
</script>

<template>
  <DirectoryCommitteesReadPage
    api-path="/enterprise/api/directory/committees"
    console-path="/console/directory/committees"
  />
</template>
