package productcenter

import (
	"encoding/json"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
)

// PlanningRetainedConsumption is persisted by an authorized command, never
// accepted directly from a browser. Its scope revision describes the confirmed
// historical scope; later edits must not erase consumption already incurred.
type PlanningRetainedConsumption struct {
	Version       int                `json:"version"`
	CycleBizID    string             `json:"cycle_biz_id"`
	ItemBizID     string             `json:"item_biz_id"`
	ScopeRevision uint64             `json:"scope_revision"`
	Category      InvestmentCategory `json:"investment_category"`
	Spent         *Hundredths        `json:"spent_person_days"`
	ConfirmedBy   string             `json:"confirmed_by"`
	ConfirmedAt   string             `json:"confirmed_at"`
	Reason        string             `json:"reason"`
}

func decodePlanningRetainedConsumption(raw []byte, cycleID, itemID, selection string) (*PlanningRetainedConsumption, error) {
	if len(raw) == 0 {
		return nil, nil
	}
	var envelope map[string]json.RawMessage
	if json.Unmarshal(raw, &envelope) != nil || envelope == nil {
		return nil, invalid("planning_consumption_snapshot_invalid", "周期决定快照无效")
	}
	encoded, present := envelope["retained_consumption"]
	if !present {
		return nil, nil
	}
	var value PlanningRetainedConsumption
	if json.Unmarshal(encoded, &value) != nil || value.Version != 1 || value.Spent == nil || *value.Spent < 0 || *value.Spent > 100_000_000 || value.ScopeRevision == 0 || !ValidInvestmentCategory(value.Category) || selection != "deferred" || value.CycleBizID != cycleID || value.ItemBizID != itemID {
		return nil, invalid("planning_consumption_snapshot_invalid", "保留消耗快照与周期事项不匹配或缺少明确投入")
	}
	for _, id := range []string{value.CycleBizID, value.ItemBizID} {
		parsed, err := uuid.Parse(id)
		if err != nil || parsed.String() != id {
			return nil, invalid("planning_consumption_snapshot_invalid", "保留消耗对象标识无效")
		}
	}
	for _, text := range []string{value.ConfirmedBy, value.Reason} {
		if strings.TrimSpace(text) == "" || !utf8.ValidString(text) || strings.ContainsRune(text, '\x00') || utf8.RuneCountInString(text) > 2000 {
			return nil, invalid("planning_consumption_snapshot_invalid", "保留消耗缺少有效确认人与理由")
		}
	}
	if value.ConfirmedBy != strings.TrimSpace(value.ConfirmedBy) || utf8.RuneCountInString(value.ConfirmedBy) > 64 {
		return nil, invalid("planning_consumption_snapshot_invalid", "保留消耗确认人标识无效")
	}
	if _, err := time.Parse(time.RFC3339Nano, value.ConfirmedAt); err != nil {
		return nil, invalid("planning_consumption_snapshot_invalid", "保留消耗确认时间无效")
	}
	return &value, nil
}
