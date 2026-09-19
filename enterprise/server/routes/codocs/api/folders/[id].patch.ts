import { enterpriseCodocsFolder } from '../../../../utils/enterpriseCodocsFolders'
export default defineEventHandler(event => enterpriseCodocsFolder(event, 'update'))
