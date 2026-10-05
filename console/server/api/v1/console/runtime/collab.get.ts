import { getPublicConsoleCollabRuntimeState } from '~~/server/utils/collabRuntime'

export default defineEventHandler(() => {
  return {
    code: 0,
    data: getPublicConsoleCollabRuntimeState()
  }
})
