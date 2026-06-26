import { getDirectoryProject, ok } from '~~/server/utils/directoryRuntime'

export default defineEventHandler(async (event) => {
  const projectCode = getRouterParam(event, 'projectCode')
  if (!projectCode) throw createError({ statusCode: 400, message: 'projectCode is required' })
  const project = await getDirectoryProject(projectCode)
  if (!project) throw createError({ statusCode: 404, message: 'Project not found' })
  return ok(project)
})
