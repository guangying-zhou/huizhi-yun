import { fetchConsoleDirectoryApi } from '../../utils/directoryApi'

export default defineEventHandler(() => fetchConsoleDirectoryApi('/meta'))
