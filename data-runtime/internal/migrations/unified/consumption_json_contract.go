package unified

import (
	"bytes"
	"context"
	"encoding/json"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/apps/aims/productcenter"
)

type consumptionConfirmResult struct {
	Confirmation      productcenter.PlanningConsumptionConfirmation `json:"confirmation"`
	WorkspaceRevision uint64                                        `json:"workspace_revision"`
	CycleRevision     uint64                                        `json:"cycle_revision"`
	QueueRevision     uint64                                        `json:"queue_revision"`
}
type consumptionWithdrawResult struct {
	CycleBizID        string                                 `json:"cycle_biz_id"`
	ItemBizID         string                                 `json:"item_biz_id"`
	WorkspaceRevision uint64                                 `json:"workspace_revision"`
	CycleRevision     uint64                                 `json:"cycle_revision"`
	QueueRevision     uint64                                 `json:"queue_revision"`
	SelectionStatus   string                                 `json:"selection_status"`
	RoadmapBucket     string                                 `json:"roadmap_bucket"`
	Impact            productcenter.PlanningWithdrawalImpact `json:"impact"`
}
type consumptionObject struct{ cycleID, itemID, workspace, cycle, queue, item, scope, evidence int64 }
type consumptionRules struct {
	ctx      context.Context
	q        querier
	schema   string
	receipts []planningReceipt
	audits   []planningAudit
}

func consumptionShape(value any, target any) bool {
	raw, e := json.Marshal(value)
	if e != nil {
		return false
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if d.Decode(target) != nil {
		return false
	}
	emitted, e := json.Marshal(target)
	if e != nil {
		return false
	}
	before, be := contractObject(raw)
	after, ae := contractObject(emitted)
	return be == nil && ae == nil && contractJSONEqual(before, after)
}
func canonicalConsumptionID(s string) bool {
	id, e := uuid.Parse(s)
	return e == nil && id.String() == s
}

func consumptionExceptions(value any) ([]productcenter.DecisionException, bool) {
	raw, err := json.Marshal(value)
	if err != nil {
		return nil, false
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	var list []productcenter.DecisionException
	err = decoder.Decode(&list)
	return list, err == nil && productcenter.ValidateDecisionExceptions(list) == nil
}

func consumptionIdentityValid(r planningReceipt) bool {
	for _, field := range []struct {
		value string
		max   int
	}{{r.product, 64}, {r.actor, 64}, {r.key, 191}} {
		if !contractText(field.value) || field.value != strings.TrimSpace(field.value) || !contractString(field.value, field.max) {
			return false
		}
		for _, char := range field.value {
			if char < 32 || char == 127 {
				return false
			}
		}
	}
	return true
}
func newConsumptionRules(ctx context.Context, q querier, schema string) (*consumptionRules, error) {
	rules := &consumptionRules{ctx: ctx, q: q, schema: schema}
	rows, e := q.QueryContext(ctx, "SELECT id,product_code,action,actor_uid,idempotency_key,request_hash,status,result_json FROM "+qualified(schema, "product_command_receipts")+" WHERE action IN ('product_priorities:consumption-confirm','product_priorities:withdraw') ORDER BY id")
	if e != nil {
		return nil, e
	}
	for rows.Next() {
		var r planningReceipt
		var raw []byte
		if e = rows.Scan(&r.id, &r.product, &r.action, &r.actor, &r.key, &r.hash, &r.status, &raw); e != nil {
			rows.Close()
			return nil, e
		}
		r.result, _ = contractObject(raw)
		rules.receipts = append(rules.receipts, r)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return nil, e
	}
	rows, e = q.QueryContext(ctx, "SELECT id,product_code,action,actor_uid,request_id,object_type,object_id,revision,changes FROM "+qualified(schema, "product_activity_logs")+" WHERE action IN ('consumption-confirm','withdraw') ORDER BY id")
	if e != nil {
		return nil, e
	}
	for rows.Next() {
		var a planningAudit
		var raw []byte
		if e = rows.Scan(&a.id, &a.product, &a.action, &a.actor, &a.key, &a.kind, &a.object, &a.revision, &raw); e != nil {
			rows.Close()
			return nil, e
		}
		a.changes, _ = contractObject(raw)
		rules.audits = append(rules.audits, a)
	}
	e = rows.Err()
	rows.Close()
	return rules, e
}
func (r *consumptionRules) object(product, cycle, item string) (consumptionObject, bool, error) {
	o := consumptionObject{}
	ready, e := hasTables(r.ctx, r.q, r.schema, "product_workspaces", "product_planning_cycles", "product_planning_items")
	if e != nil || !ready {
		return o, false, e
	}
	rows, e := r.q.QueryContext(r.ctx, "SELECT c.id,i.id,w.revision,c.revision,c.queue_revision,i.revision,i.scope_revision,i.evidence_revision FROM "+qualified(r.schema, "product_workspaces")+" w JOIN "+qualified(r.schema, "product_planning_cycles")+" c ON BINARY c.product_code=BINARY w.product_code JOIN "+qualified(r.schema, "product_planning_items")+" i ON BINARY i.product_code=BINARY w.product_code WHERE BINARY w.product_code=BINARY ? AND BINARY c.biz_id=BINARY ? AND BINARY i.biz_id=BINARY ?", product, cycle, item)
	if e != nil {
		return o, false, e
	}
	defer rows.Close()
	if !rows.Next() {
		return o, false, rows.Err()
	}
	e = rows.Scan(&o.cycleID, &o.itemID, &o.workspace, &o.cycle, &o.queue, &o.item, &o.scope, &o.evidence)
	return o, e == nil && o.workspace > 0 && o.cycle > 0 && o.queue > 0 && o.item > 0 && o.scope > 0 && o.evidence > 0, e
}
func (r *consumptionRules) pair(receipt planningReceipt, a planningAudit, cycle string, revision uint64) bool {
	return a.kind == "planning_cycle" && a.object == cycle && a.product == receipt.product && a.actor == receipt.actor && a.key == receipt.key && a.action == strings.TrimPrefix(receipt.action, "product_priorities:") && a.revision == int64(revision)
}
func (r *consumptionRules) confirmationShape(value any, product, cycle, item string, depth int) (productcenter.PlanningConsumptionConfirmation, bool, error) {
	var c productcenter.PlanningConsumptionConfirmation
	if depth > 4 || !consumptionShape(value, &c) || c.Version != 1 || !canonicalConsumptionID(c.ConfirmationID) || c.CycleBizID != cycle || c.ItemBizID != item || !canonicalConsumptionID(cycle) || !canonicalConsumptionID(item) || c.ItemRevision == 0 || c.ScopeRevision == 0 || c.Spent == nil || *c.Spent < 0 || *c.Spent > 100000000 || !productcenter.ValidInvestmentCategory(c.Category) || !contractText(c.Reason) || !contractString(c.Reason, 2000) || !contractText(c.ConfirmedBy) || c.ConfirmedBy != strings.TrimSpace(c.ConfirmedBy) || !contractString(c.ConfirmedBy, 64) {
		return c, false, nil
	}
	if _, e := time.Parse(time.RFC3339Nano, c.ConfirmedAt); e != nil {
		return c, false, nil
	}
	o, found, e := r.object(product, cycle, item)
	if e != nil || !found {
		return c, false, e
	}
	if c.ItemRevision > uint64(o.item) || c.ScopeRevision > uint64(o.scope) {
		return c, false, nil
	}
	d, e := contractObject(c.DecisionSnapshot)
	if e != nil {
		return c, false, nil
	}
	if _, nested := d["pending_consumption"]; nested {
		return c, false, nil
	}
	valid, e := r.capacityDecision(product, cycle, item, d, depth+1)
	if e != nil || !valid {
		return c, false, e
	}
	capacity, _ := d["capacity"].(map[string]any)
	return c, capacity["investment_category"] == string(c.Category), nil
}
func (r *consumptionRules) capacityDecision(product, cycle, item string, m map[string]any, depth int) (bool, error) {
	if depth > 4 || !contractKeys(m, "capacity assessment_id scope_revision evidence_revision model_version exceptions pending_consumption") {
		return false, nil
	}
	c, ok := m["capacity"].(map[string]any)
	if !ok || !contractKeys(c, "version item_biz_id investment_category effort_person_days") || contractInt(c["version"]) != 1 || c["item_biz_id"] != item {
		return false, nil
	}
	category, ok := c["investment_category"].(string)
	if !ok || !productcenter.ValidInvestmentCategory(productcenter.InvestmentCategory(category)) {
		return false, nil
	}
	if _, exists := c["effort_person_days"]; !exists {
		return false, nil
	}
	if c["effort_person_days"] != nil {
		a, valid := planAmount(c["effort_person_days"])
		if !valid || a < 50 || a > 100000000 {
			return false, nil
		}
	}
	o, found, e := r.object(product, cycle, item)
	if e != nil || !found {
		return false, e
	}
	baseCount := len(m)
	if _, pending := m["pending_consumption"]; pending {
		baseCount--
	}
	// The consumption reader accepts the historical capacity-only envelope;
	// selection's writer additionally freezes assessment/scope/evidence/model.
	if baseCount != 1 {
		if baseCount != 6 || contractInt(m["assessment_id"]) < 1 || contractInt(m["scope_revision"]) < 1 || contractInt(m["scope_revision"]) > o.scope || contractInt(m["evidence_revision"]) < 1 || contractInt(m["evidence_revision"]) > o.evidence || !contractText(m["model_version"]) {
			return false, nil
		}
		if _, valid := consumptionExceptions(m["exceptions"]); !valid {
			return false, nil
		}
		ref, e := contractReference(r.ctx, r.q, r.schema, "product_priority_assessments", "id=? AND planning_item_id=? AND cycle_id=? AND scope_revision=? AND evidence_revision=? AND BINARY model_version=BINARY ?", m["assessment_id"], o.itemID, o.cycleID, m["scope_revision"], m["evidence_revision"], m["model_version"])
		if e != nil || !ref {
			return false, e
		}
	}
	if pending, exists := m["pending_consumption"]; exists {
		_, valid, e := r.confirmationShape(pending, product, cycle, item, depth+1)
		if e != nil || !valid {
			return false, e
		}
		return r.confirmationEvidence(product, pending)
	}
	return true, nil
}
func (r *consumptionRules) confirmReceipt(receipt planningReceipt) (bool, error) {
	var result consumptionConfirmResult
	if !consumptionIdentityValid(receipt) || receipt.status != "succeeded" || !consumptionShape(receipt.result, &result) || result.WorkspaceRevision < 2 || result.CycleRevision < 2 || result.QueueRevision < 2 {
		return false, nil
	}
	c, valid, e := r.confirmationShape(receipt.result["confirmation"], receipt.product, result.Confirmation.CycleBizID, result.Confirmation.ItemBizID, 0)
	if e != nil || !valid {
		return false, e
	}
	if c.ConfirmedBy != receipt.actor {
		return false, nil
	}
	o, found, e := r.object(receipt.product, c.CycleBizID, c.ItemBizID)
	if e != nil || !found {
		return false, e
	}
	if result.WorkspaceRevision > uint64(o.workspace) || result.CycleRevision > uint64(o.cycle) || result.QueueRevision > uint64(o.queue) {
		return false, nil
	}
	input := productcenter.PlanningConsumptionConfirm{PlanningCycleCandidateAdd: productcenter.PlanningCycleCandidateAdd{CycleBizID: c.CycleBizID, ItemBizID: c.ItemBizID, ExpectedRevision: result.WorkspaceRevision - 1, ExpectedCycleRevision: result.CycleRevision - 1, ExpectedItemRevision: c.ItemRevision}, ExpectedQueueRevision: result.QueueRevision - 1, ExpectedScopeRevision: c.ScopeRevision, Spent: c.Spent, Reason: c.Reason}
	if productcenter.ValidatePlanningConsumptionConfirm(input) != nil || !typedPayloadValid(input, &productcenter.PlanningConsumptionConfirm{}, receipt.hash) {
		return false, nil
	}
	count := 0
	for _, a := range r.audits {
		if r.pair(receipt, a, c.CycleBizID, result.CycleRevision) && contractJSONEqual(a.changes, receipt.result["confirmation"]) {
			count++
		}
	}
	return count == 1, nil
}
func (r *consumptionRules) confirmationEvidence(product string, value any) (bool, error) {
	for _, receipt := range r.receipts {
		if receipt.action == "product_priorities:consumption-confirm" && receipt.product == product && contractJSONEqual(receipt.result["confirmation"], value) {
			valid, e := r.confirmReceipt(receipt)
			if e != nil {
				return false, e
			}
			if valid {
				return true, nil
			}
		}
	}
	return false, nil
}

func consumptionReportValid(report productcenter.CapacityReport) bool {
	const maxAggregate = 1000000000000
	if report.SelectedEffort < 0 || report.SelectedEffort > maxAggregate || report.RetainedEffort < 0 || report.RetainedEffort > maxAggregate || report.Available < 0 || report.Available > 100000000 || report.OccupiedEffort != report.SelectedEffort+report.RetainedEffort || report.Remaining != report.Available-report.OccupiedEffort || report.UnknownEstimates < 0 || report.UnknownEstimates > 10000 || report.ByCategory == nil || report.Issues == nil {
		return false
	}
	var total productcenter.Hundredths
	for category, value := range report.ByCategory {
		if !productcenter.ValidInvestmentCategory(category) || value < 0 || value > maxAggregate {
			return false
		}
		total += value
	}
	if total != report.OccupiedEffort {
		return false
	}
	for _, issue := range report.Issues {
		switch issue.Code {
		case "assessment_required", "effort_required", "cross_dependency_unresolved":
			if !canonicalConsumptionID(issue.ItemID) || issue.PredecessorID != "" || issue.Category != "" {
				return false
			}
		case "dependency_unresolved":
			if !canonicalConsumptionID(issue.ItemID) || !canonicalConsumptionID(issue.PredecessorID) || issue.Category != "" {
				return false
			}
		case "capacity_exceeded":
			if issue.ItemID != "" || issue.PredecessorID != "" || issue.Category != "" {
				return false
			}
		case "category_capacity_exceeded":
			if issue.ItemID != "" || issue.PredecessorID != "" || !productcenter.ValidInvestmentCategory(issue.Category) {
				return false
			}
		default:
			return false
		}
	}
	return true
}
func consumptionComparisonValid(value productcenter.CapacityComparison) bool {
	if !consumptionReportValid(value.Confirmed) || !consumptionReportValid(value.Latest) || value.Confirmed.Available != value.Latest.Available || value.Changes == nil {
		return false
	}
	seen := map[string]bool{}
	for _, change := range value.Changes {
		if !canonicalConsumptionID(change.ItemID) || seen[change.ItemID] || !productcenter.ValidInvestmentCategory(change.ConfirmedCategory) || !productcenter.ValidInvestmentCategory(change.LatestCategory) {
			return false
		}
		seen[change.ItemID] = true
		for _, amount := range []*productcenter.Hundredths{change.Confirmed, change.Latest} {
			if amount != nil && (*amount < 50 || *amount > 100000000) {
				return false
			}
		}
		if change.Confirmed == nil || change.Latest == nil {
			if change.Delta != nil {
				return false
			}
		} else if change.Delta == nil || *change.Delta != *change.Latest-*change.Confirmed {
			return false
		}
	}
	return true
}
func (r *consumptionRules) withdrawReceipt(receipt planningReceipt) (map[string]any, bool, error) {
	var result consumptionWithdrawResult
	if !consumptionIdentityValid(receipt) || receipt.status != "succeeded" || len(receipt.hash) != 64 || !hexOnlySnapshot(receipt.hash) || receipt.hash != strings.ToLower(receipt.hash) || !consumptionShape(receipt.result, &result) || result.SelectionStatus != "deferred" || result.RoadmapBucket != "later" || result.WorkspaceRevision < 2 || result.CycleRevision < 2 || result.QueueRevision < 2 {
		return nil, false, nil
	}
	impact := result.Impact
	if impact.CanConfirm || impact.Blocker != nil || impact.CycleBizID != result.CycleBizID || impact.ItemBizID != result.ItemBizID || impact.WorkspaceRevision+1 != result.WorkspaceRevision || impact.CycleRevision+1 != result.CycleRevision || impact.QueueRevision+1 != result.QueueRevision || !consumptionComparisonValid(impact.Before) || !consumptionComparisonValid(impact.After) {
		return nil, false, nil
	}
	remainingChanges := []productcenter.EffortChange{}
	for _, change := range impact.Before.Changes {
		if change.ItemID != result.ItemBizID {
			remainingChanges = append(remainingChanges, change)
		}
	}
	expectedChanges, _ := json.Marshal(remainingChanges)
	actualChanges, _ := json.Marshal(impact.After.Changes)
	var expectedList, actualList any
	if json.Unmarshal(expectedChanges, &expectedList) != nil || json.Unmarshal(actualChanges, &actualList) != nil || !contractJSONEqual(expectedList, actualList) {
		return nil, false, nil
	}
	o, found, e := r.object(receipt.product, result.CycleBizID, result.ItemBizID)
	if e != nil || !found {
		return nil, false, e
	}
	if result.WorkspaceRevision > uint64(o.workspace) || result.CycleRevision > uint64(o.cycle) || result.QueueRevision > uint64(o.queue) {
		return nil, false, nil
	}
	previous, e := contractObject(impact.PreviousDecision)
	if e != nil {
		return nil, false, nil
	}
	valid, e := r.capacityDecision(receipt.product, result.CycleBizID, result.ItemBizID, previous, 0)
	if e != nil || !valid {
		return nil, false, e
	}
	count := 0
	var selected *planningAudit
	for i := range r.audits {
		a := r.audits[i]
		if r.pair(receipt, a, result.CycleBizID, result.CycleRevision) && contractKeys(a.changes, "impact reason impact_note exceptions") && contractJSONEqual(a.changes["impact"], receipt.result["impact"]) {
			count++
			selected = &r.audits[i]
		}
	}
	if count != 1 {
		return nil, false, nil
	}
	a := *selected
	input := productcenter.PlanningWithdrawal{PlanningCycleCandidateAdd: productcenter.PlanningCycleCandidateAdd{CycleBizID: result.CycleBizID, ItemBizID: result.ItemBizID, ExpectedRevision: impact.WorkspaceRevision, ExpectedCycleRevision: impact.CycleRevision, ExpectedItemRevision: uint64(o.item)}, ExpectedQueueRevision: impact.QueueRevision}
	input.Reason, _ = a.changes["reason"].(string)
	input.ImpactNote, _ = a.changes["impact_note"].(string)
	var exceptionShape bool
	input.Exceptions, exceptionShape = consumptionExceptions(a.changes["exceptions"])
	if !exceptionShape || productcenter.ValidatePlanningWithdrawal(input) != nil || productcenter.ConfirmDecision(impact.After.Latest, input.Exceptions) != nil {
		return nil, false, nil
	}
	decision := map[string]any{"action": "withdraw", "previous_decision": previous, "exceptions": a.changes["exceptions"]}
	var spent productcenter.Hundredths
	if impact.Consumption != nil {
		encoded, _ := json.Marshal(impact.Consumption)
		cvalue, _ := contractObject(encoded)
		c, valid, e := r.confirmationShape(cvalue, receipt.product, result.CycleBizID, result.ItemBizID, 0)
		if e != nil || !valid {
			return nil, false, e
		}
		proof, e := r.confirmationEvidence(receipt.product, cvalue)
		if e != nil || !proof {
			return nil, false, e
		}
		if !contractJSONEqual(previous["pending_consumption"], cvalue) {
			return nil, false, nil
		}
		base := map[string]any{}
		for key, value := range previous {
			if key != "pending_consumption" {
				base[key] = value
			}
		}
		original, _ := contractObject(c.DecisionSnapshot)
		if !contractJSONEqual(base, original) {
			return nil, false, nil
		}
		input.ConsumptionConfirmationID = c.ConfirmationID
		input.ExpectedItemRevision = c.ItemRevision
		if productcenter.ValidatePlanningWithdrawal(input) != nil || !typedPayloadValid(input, &productcenter.PlanningWithdrawal{}, receipt.hash) {
			return nil, false, nil
		}
		spent = *c.Spent
		retainedRaw, _ := json.Marshal(c.PlanningRetainedConsumption)
		retained, _ := contractObject(retainedRaw)
		decision["retained_consumption"] = retained
		decision["consumption_confirmation_id"] = c.ConfirmationID
	}
	capacity, _ := previous["capacity"].(map[string]any)
	category, _ := capacity["investment_category"].(string)
	effort := int64(0)
	unknown := 0
	if capacity["effort_person_days"] == nil {
		unknown = 1
	} else {
		effort, _ = planAmount(capacity["effort_person_days"])
	}
	before, after := impact.Before.Confirmed, impact.After.Confirmed
	if before.Available != after.Available || before.SelectedEffort-productcenter.Hundredths(effort) != after.SelectedEffort || before.RetainedEffort+spent != after.RetainedEffort || before.UnknownEstimates-unknown != after.UnknownEstimates {
		return nil, false, nil
	}
	for _, key := range []productcenter.InvestmentCategory{productcenter.Reliability, productcenter.Usability, productcenter.Growth} {
		expected := before.ByCategory[key]
		if string(key) == category {
			expected += spent - productcenter.Hundredths(effort)
		}
		if after.ByCategory[key] != expected {
			return nil, false, nil
		}
	}
	latestEffort, latestCategory, latestUnknown := productcenter.Hundredths(effort), productcenter.InvestmentCategory(category), unknown
	for _, change := range impact.Before.Changes {
		if change.ItemID == result.ItemBizID {
			if change.ConfirmedCategory != productcenter.InvestmentCategory(category) || (change.Confirmed == nil) != (unknown == 1) || (change.Confirmed != nil && *change.Confirmed != productcenter.Hundredths(effort)) {
				return nil, false, nil
			}
			latestCategory = change.LatestCategory
			latestEffort, latestUnknown = 0, 1
			if change.Latest != nil {
				latestEffort, latestUnknown = *change.Latest, 0
			}
		}
	}
	before, after = impact.Before.Latest, impact.After.Latest
	if before.Available != after.Available || before.SelectedEffort-latestEffort != after.SelectedEffort || before.RetainedEffort+spent != after.RetainedEffort || before.UnknownEstimates-latestUnknown != after.UnknownEstimates {
		return nil, false, nil
	}
	for _, key := range []productcenter.InvestmentCategory{productcenter.Reliability, productcenter.Usability, productcenter.Growth} {
		expected := before.ByCategory[key]
		if key == latestCategory {
			expected -= latestEffort
		}
		if string(key) == category {
			expected += spent
		}
		if after.ByCategory[key] != expected {
			return nil, false, nil
		}
	}
	// Proposed withdrawal does not persist ExpectedItemRevision. Its old
	// fingerprint cannot be recomputed from a later mutable item revision;
	// validate its actual persisted hash format + paired frozen impact instead.
	return decision, true, nil
}
func (r *consumptionRules) decision(product, cycle, item string, m map[string]any, depth int) (bool, error) {
	if m["action"] == nil {
		return r.capacityDecision(product, cycle, item, m, depth)
	}
	if depth > 4 || m["action"] != "withdraw" || !contractKeys(m, "action previous_decision exceptions retained_consumption consumption_confirmation_id") {
		return false, nil
	}
	for _, receipt := range r.receipts {
		if receipt.action == "product_priorities:withdraw" && receipt.product == product && receipt.result["cycle_biz_id"] == cycle && receipt.result["item_biz_id"] == item {
			expected, valid, e := r.withdrawReceipt(receipt)
			if e != nil {
				return false, e
			}
			if valid && contractJSONEqual(expected, m) {
				return true, nil
			}
		}
	}
	return false, nil
}
func inspectConsumptionJSON(ctx context.Context, q querier, schema string) ([]MigrationConflict, error) {
	r, e := newConsumptionRules(ctx, q, schema)
	if e != nil {
		return nil, e
	}
	issues := []MigrationConflict{}
	validReceipts := map[int64]bool{}
	for _, receipt := range r.receipts {
		valid := false
		if receipt.action == "product_priorities:consumption-confirm" {
			valid, e = r.confirmReceipt(receipt)
		} else {
			_, valid, e = r.withdrawReceipt(receipt)
		}
		if e != nil {
			return nil, e
		}
		validReceipts[receipt.id] = valid
		if !valid {
			issues = append(issues, MigrationConflict{Kind: "consumption_command_receipt_invalid", Source: "aims.product_command_receipts", KeySHA256: redactedBusinessKey("consumption-receipt", stringID(receipt.id)), RowCount: 1})
		}
	}
	for _, a := range r.audits {
		paired := false
		for _, receipt := range r.receipts {
			if validReceipts[receipt.id] {
				if receipt.action == "product_priorities:consumption-confirm" {
					var result consumptionConfirmResult
					if consumptionShape(receipt.result, &result) && r.pair(receipt, a, result.Confirmation.CycleBizID, result.CycleRevision) && contractJSONEqual(a.changes, receipt.result["confirmation"]) {
						paired = true
					}
				} else {
					var result consumptionWithdrawResult
					if consumptionShape(receipt.result, &result) && r.pair(receipt, a, result.CycleBizID, result.CycleRevision) && contractKeys(a.changes, "impact reason impact_note exceptions") && contractJSONEqual(a.changes["impact"], receipt.result["impact"]) {
						paired = true
					}
				}
			}
		}
		if !paired {
			issues = append(issues, MigrationConflict{Kind: "consumption_command_audit_invalid", Source: "aims.product_activity_logs", KeySHA256: redactedBusinessKey("consumption-audit", stringID(a.id)), RowCount: 1})
		}
	}
	ready, e := hasTables(ctx, q, schema, "product_planning_cycle_items", "product_planning_cycles", "product_planning_items")
	if e != nil || !ready {
		return issues, e
	}
	rows, e := q.QueryContext(ctx, "SELECT ci.cycle_id,ci.planning_item_id,ci.product_code,COALESCE(c.biz_id,''),COALESCE(i.biz_id,''),ci.selection_status,ci.decision_snapshot FROM "+qualified(schema, "product_planning_cycle_items")+" ci LEFT JOIN "+qualified(schema, "product_planning_cycles")+" c ON c.id=ci.cycle_id AND BINARY c.product_code=BINARY ci.product_code LEFT JOIN "+qualified(schema, "product_planning_items")+" i ON i.id=ci.planning_item_id AND BINARY i.product_code=BINARY ci.product_code WHERE ci.decision_snapshot IS NOT NULL ORDER BY ci.cycle_id,ci.planning_item_id")
	if e != nil {
		return nil, e
	}
	type snapshot struct {
		cycleID, itemID                 int64
		product, cycle, item, selection string
		raw                             []byte
	}
	all := []snapshot{}
	for rows.Next() {
		var s snapshot
		if e = rows.Scan(&s.cycleID, &s.itemID, &s.product, &s.cycle, &s.item, &s.selection, &s.raw); e != nil {
			rows.Close()
			return nil, e
		}
		all = append(all, s)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return nil, e
	}
	for _, s := range all {
		m, e := contractObject(s.raw)
		valid := e == nil && canonicalConsumptionID(s.cycle) && canonicalConsumptionID(s.item) && (s.selection == "candidate" || s.selection == "selected" || s.selection == "deferred")
		if m["action"] == "withdraw" && s.selection != "deferred" {
			valid = false
		}
		if valid {
			valid, e = r.decision(s.product, s.cycle, s.item, m, 0)
			if e != nil {
				return nil, e
			}
		}
		if !valid {
			issues = append(issues, MigrationConflict{Kind: "consumption_decision_snapshot_invalid", Source: "aims.product_planning_cycle_items", KeySHA256: redactedBusinessKey("consumption-decision", stringID(s.cycleID)+":"+stringID(s.itemID)), RowCount: 1})
		}
	}
	return issues, nil
}
