<script setup lang="ts">
definePageMeta({ hostContentInset: false, name: 'console-host-directory-departments', navigationOwner: 'console' })
</script>

<template>
  <DirectoryDepartmentsReadPage
    api-path="/enterprise/api/directory/departments"
    console-path="/console/directory/departments"
  />
</template>
