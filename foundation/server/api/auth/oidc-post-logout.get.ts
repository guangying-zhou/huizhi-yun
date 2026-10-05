import { handleConsoleOidcPostLogout } from '../../utils/consoleOidc'

export default defineEventHandler(event => handleConsoleOidcPostLogout(event))
