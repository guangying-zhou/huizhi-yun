import { defineEventHandler } from 'h3'
import { enterpriseAimsWorkItemCommitDiff } from '~~/server/utils/enterpriseAimsGitlab'

export default defineEventHandler(enterpriseAimsWorkItemCommitDiff)
