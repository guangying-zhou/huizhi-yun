import { defineEventHandler } from 'h3'
import { enterpriseAimsProjectSyncGitlab } from '~~/server/utils/enterpriseAimsGitlab'

export default defineEventHandler(enterpriseAimsProjectSyncGitlab)
