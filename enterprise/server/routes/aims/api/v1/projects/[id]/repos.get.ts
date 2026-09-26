import { defineEventHandler } from 'h3'
import { enterpriseAimsProjectRepos } from '~~/server/utils/enterpriseAimsProjectWorkspace'

export default defineEventHandler(enterpriseAimsProjectRepos)
