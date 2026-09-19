import { defineEventHandler } from 'h3'
import { enterpriseAimsRepoDocsTree } from '~~/server/utils/enterpriseAimsProjectDocumentSources'

export default defineEventHandler(enterpriseAimsRepoDocsTree)
