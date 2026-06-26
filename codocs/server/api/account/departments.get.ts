import { fetchDirectoryResponse } from '../../utils/directoryCompat'
import type { DepartmentResponse } from '~/types/account'

export default defineEventHandler(event =>
  fetchDirectoryResponse<DepartmentResponse>('/departments', {
    params: getQuery(event) as Record<string, unknown>
  })
)
