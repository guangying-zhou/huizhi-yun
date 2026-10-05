import { defineEventHandler } from 'h3'
import { enterpriseAimsWorkItemCommitUnlink } from '~~/server/utils/enterpriseAimsWorkItemWorkspace'

export default defineEventHandler(enterpriseAimsWorkItemCommitUnlink)
