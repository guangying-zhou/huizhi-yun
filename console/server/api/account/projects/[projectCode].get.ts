import { getDirectoryProject, ok } from '~~/server/utils/directoryRuntime'

export default defineEventHandler(async (event) => {
  const projectCode = decodeURIComponent(getRouterParam(event, 'projectCode') || '').trim()
  if (!projectCode) throw createError({ statusCode: 400, message: 'Project ID is required' })

  const project = await getDirectoryProject(projectCode)
  if (!project) throw createError({ statusCode: 404, message: 'Project not found' })
  return ok(project)
})
