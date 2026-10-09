package altoc

// These pure owning-domain rules are shared by the standalone and Host lanes.
// No DB adapter or caller-supplied authentication facts enter this API.
func EnterpriseLeadCreate(p map[string]any, actor, code string) (map[string]any, error) {
	b := enterpriseSalesLegacyAliases(p)
	if err := validateLeadCreateQualification(b); err != nil {
		return nil, err
	}
	row, err := leadCreateFields(b, actor, code)
	if err == nil {
		row["owner_uid"] = row["owner_user_id"]
		delete(row, "owner_user_id")
	}
	return row, err
}
func EnterpriseLeadQualification(row, p map[string]any, actor string) error {
	return validateLeadConversionQualification(enterpriseSalesLegacyAliases(row), enterpriseSalesLegacyAliases(p), actor)
}
func enterpriseSalesLegacyAliases(p map[string]any) map[string]any {
	out := map[string]any{}
	for k, v := range p {
		out[k] = v
	}
	if v, ok := out["owner_uid"]; ok {
		out["owner_user_id"] = v
	}
	return out
}
func EnterpriseOpportunityCreate(p map[string]any) error {
	return validateOpportunityCreateInput(enterpriseSalesLegacyAliases(p))
}
func EnterpriseOpportunityTransition(current, target, row, p map[string]any) error {
	if err := validateOpportunityNextActionDuePair(row, p); err != nil {
		return err
	}
	if err := validateOpportunityTerminalReasons(opportunityStatusForStage(target), row, p); err != nil {
		return err
	}
	if err := validateOpportunityStageRequirements(target, row, p); err != nil {
		return err
	}
	fields, err := opportunityCriteriaFields(current["exit_criteria_json"], "exit_criteria_json")
	if err != nil {
		return err
	}
	return validateOpportunityStageExitCriteria(current, target, row, p, fields)
}
func EnterpriseStageStatus(stage map[string]any) string { return opportunityStatusForStage(stage) }

func EnterpriseOpportunityUpdate(row, p map[string]any) error {
	if _, err := opportunityDetailUpdates(enterpriseSalesLegacyAliases(p)); err != nil {
		return err
	}
	return validateOpportunityNextActionDuePair(row, p)
}
