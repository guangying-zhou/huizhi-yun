import { defineEventHandler } from 'h3'
import { enterpriseAimsProjectRepoCandidates } from '~~/server/utils/enterpriseAimsProjectOutput'

export default defineEventHandler(enterpriseAimsProjectRepoCandidates)
