import { defineEventHandler } from 'h3'
import { enterpriseAimsProjectRepoUnlink } from '~~/server/utils/enterpriseAimsProjectWorkspace'

export default defineEventHandler(enterpriseAimsProjectRepoUnlink)
