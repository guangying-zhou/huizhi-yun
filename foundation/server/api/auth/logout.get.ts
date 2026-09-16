import { handleConsoleOidcLogout } from '../../utils/consoleOidc'

export default defineEventHandler(event => handleConsoleOidcLogout(event))
