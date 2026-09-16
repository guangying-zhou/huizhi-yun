import { startConsoleOidcLogin } from '../../utils/consoleOidc'

export default defineEventHandler(event => startConsoleOidcLogin(event))
