import { defineEventHandler } from 'h3'
import { enterpriseAimsProjectGitlabCommits } from '~~/server/utils/enterpriseAimsGitlab'

export default defineEventHandler(enterpriseAimsProjectGitlabCommits)
