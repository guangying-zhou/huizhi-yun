import { drainDirectoryLifecycleOperations } from '~~/server/utils/directoryLifecycleOperation'

export default defineTask({
  meta: { name: 'integrations:directory-lifecycle', description: 'Reliably projects People lifecycle facts to Console Directory.' },
  async run() {
    return { result: await drainDirectoryLifecycleOperations() }
  }
})
