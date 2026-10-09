import { handleConsoleOidcCallback } from '../../utils/consoleOidc'

export default defineEventHandler(event => handleConsoleOidcCallback(event))
