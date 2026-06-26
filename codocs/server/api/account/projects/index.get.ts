import { fetchDirectoryResponse } from '../../../utils/directoryCompat'
import type { ProjectListResponse } from '~/types/account'

export default defineEventHandler(event =>
  fetchDirectoryResponse<ProjectListResponse>('/projects', {
    params: getQuery(event) as Record<string, unknown>
  })
)
