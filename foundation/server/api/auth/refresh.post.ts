import { handleConsoleOidcRefresh } from '../../utils/consoleOidc'

export default defineEventHandler(event => handleConsoleOidcRefresh(event))
