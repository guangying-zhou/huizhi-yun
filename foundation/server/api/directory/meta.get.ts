import { fetchConsoleDirectoryApi } from '../../utils/directoryApi'

export default defineEventHandler(event => fetchConsoleDirectoryApi('/meta', { event }))
