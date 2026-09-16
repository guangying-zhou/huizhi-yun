package productcenter

import (
	"github.com/google/uuid"
	"strings"
	"time"
	"unicode/utf8"
)

// RICEReachObservation must be loaded from a persisted, authorized observation.
// An assessment request references its identity; it cannot assert verification.
type RICEReachObservation struct {
	BizID            string `json:"biz_id"`
	ProductCode      string `json:"product_code"`
	ItemBizID        string `json:"item_biz_id"`
	ModelVersion     string `json:"model_version"`
	ScopeRevision    uint64 `json:"scope_revision"`
	EvidenceRevision uint64 `json:"evidence_revision"`
	Reach            int64  `json:"reach"`
	ReachUnit        string `json:"reach_unit"`
	ReachStartsOn    string `json:"reach_starts_on"`
	ReachEndsOn      string `json:"reach_ends_on"`
	ReachDefinition  string `json:"reach_definition"`
	SourceDefinition string `json:"source_definition"`
	SourceReference  string `json:"source_reference"`
	Methodology      string `json:"methodology"`
	RecordedBy       string `json:"recorded_by"`
	RecordedAt       string `json:"recorded_at"`
}

// Binding all comparison facts prevents reusing a count across products,
// item scopes, evidence revisions, population definitions or time windows.
func ValidateRICEReachObservation(model RICEAssessmentModel, observation RICEReachObservation, productCode, itemBizID string, scopeRevision, evidenceRevision uint64) error {
	if err := model.Validate(); err != nil {
		return err
	}
	canonicalUUID := func(value string) bool {
		parsed, err := uuid.Parse(value)
		return err == nil && parsed.String() == value
	}
	if !canonicalUUID(observation.BizID) || !canonicalUUID(itemBizID) || observation.ItemBizID != itemBizID || productCode == "" || observation.ProductCode != productCode || observation.ModelVersion != model.Version || scopeRevision == 0 || evidenceRevision == 0 || observation.ScopeRevision != scopeRevision || observation.EvidenceRevision != evidenceRevision {
		return invalid("rice_observation_stale", "Reach 观测与当前产品、事项范围、证据或模型版本不一致")
	}
	if observation.ReachUnit != model.ReachUnit || observation.ReachStartsOn != model.ReachStartsOn || observation.ReachEndsOn != model.ReachEndsOn || observation.ReachDefinition != model.ReachDefinition || observation.SourceDefinition != model.SourceDefinition {
		return invalid("rice_observation_definition_mismatch", "Reach 观测的对象、窗口或取数口径与模型不一致")
	}
	if observation.Reach < 0 || observation.Reach > 1_000_000_000 {
		return invalid("rice_reach_invalid", "Reach 须为 0～1000000000 的去重对象数")
	}
	for _, value := range []string{observation.SourceReference, observation.Methodology, observation.RecordedBy} {
		if strings.TrimSpace(value) == "" || !utf8.ValidString(value) || strings.ContainsRune(value, 0) || utf8.RuneCountInString(value) > 2000 {
			return invalid("rice_observation_evidence_required", "Reach 观测需要可追溯来源、取数方法和记录人")
		}
	}
	if _, err := time.Parse(time.RFC3339Nano, observation.RecordedAt); err != nil {
		return invalid("rice_observation_evidence_required", "Reach 观测记录时间无效")
	}
	return nil
}
