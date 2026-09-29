<script setup lang="ts">
definePageMeta({ hostContentInset: false, name: 'console-host-directory-projects', navigationOwner: 'console' })
</script>

<template>
  <DirectoryProjectsReadPage
    api-path="/enterprise/api/directory/projects"
    console-path="/console/directory/projects"
  />
</template>
