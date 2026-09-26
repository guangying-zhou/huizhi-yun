import { defineEventHandler } from 'h3'
import { enterpriseAimsRepoDoc } from '~~/server/utils/enterpriseAimsProjectDocumentSources'

export default defineEventHandler(enterpriseAimsRepoDoc)
