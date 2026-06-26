import type { OpportunityStage } from '~/types/altoc'

export type OpportunityTerminalMode = 'won' | 'lost' | 'paused'

export function opportunityStageFlagEnabled(value: unknown) {
  return value === true || value === 1 || value === '1'
}

export function opportunityStageEnabled(stage: OpportunityStage) {
  const value = stage.is_enabled as unknown
  return value !== 0 && value !== false && value !== '0'
}

export function opportunityStagePipelineCode(stage: OpportunityStage) {
  return stage.pipeline_code || 'default'
}

export function opportunityStageMatchesTerminalMode(stage: OpportunityStage, mode: OpportunityTerminalMode) {
  const kind = stage.stage_kind || 'normal'
  if (mode === 'won') return kind === 'won' || opportunityStageFlagEnabled(stage.is_won)
  if (mode === 'lost') return kind === 'lost' || opportunityStageFlagEnabled(stage.is_lost)
  return kind === 'paused' || stage.code === 'paused'
}

export function opportunityStageRuntimeStatus(stage: OpportunityStage | null | undefined) {
  if (!stage) return 'active'
  if (opportunityStageMatchesTerminalMode(stage, 'won')) return 'won'
  if (opportunityStageMatchesTerminalMode(stage, 'lost')) return 'lost'
  if (opportunityStageMatchesTerminalMode(stage, 'paused')) return 'paused'
  return 'active'
}

export function isOpportunityOpenNormalStage(stage: OpportunityStage) {
  const kind = stage.stage_kind || 'normal'
  return opportunityStageEnabled(stage)
    && kind === 'normal'
    && !opportunityStageFlagEnabled(stage.is_closed)
    && !opportunityStageFlagEnabled(stage.is_won)
    && !opportunityStageFlagEnabled(stage.is_lost)
    && stage.code !== 'paused'
}
