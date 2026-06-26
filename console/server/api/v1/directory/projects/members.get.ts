import { getDirectoryProject, listDirectoryProjectMembers, ok } from '~~/server/utils/directoryRuntime'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const projectCode = String(query.projectCode || query.project_code || '').trim()
  if (!projectCode) throw createError({ statusCode: 400, message: 'projectCode is required' })

  const project = await getDirectoryProject(projectCode)
  if (!project) throw createError({ statusCode: 404, message: 'Project not found' })

  return ok(await listDirectoryProjectMembers(projectCode, query))
})
