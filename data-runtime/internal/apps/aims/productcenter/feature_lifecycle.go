package productcenter

import (
	"github.com/google/uuid"
	"strings"
	"unicode/utf8"
)

// FeatureActivationEvidence describes a reference to verify, not a caller's
// assertion that a release is valid. Release references require DB validation.
type FeatureActivationEvidence struct {
	Kind         string `json:"kind"`
	Description  string `json:"description"`
	ReleaseBizID string `json:"release_biz_id"`
}

type FeatureLifecycleChange struct {
	ExpectedRevision        uint64                     `json:"expected_revision"`
	ExpectedFeatureRevision uint64                     `json:"expected_feature_revision"`
	BizID                   string                     `json:"biz_id"`
	Target                  string                     `json:"target"`
	Reason                  string                     `json:"reason"`
	Evidence                *FeatureActivationEvidence `json:"evidence"`
}

func ValidateFeatureLifecycleChange(input FeatureLifecycleChange) error {
	id, err := uuid.Parse(input.BizID)
	if err != nil || id.String() != input.BizID {
		return invalid("product_feature_id_invalid", "功能标识无效")
	}
	if input.ExpectedRevision == 0 || input.ExpectedFeatureRevision == 0 {
		return invalid("product_revision_required", "必须提供产品与功能版本号")
	}
	validText := func(value string, max int) bool {
		return utf8.ValidString(value) && strings.TrimSpace(value) != "" && utf8.RuneCountInString(value) <= max && !strings.ContainsRune(value, '\x00')
	}
	if !validText(input.Reason, 2000) {
		return invalid("product_feature_reason_invalid", "生命周期变更原因必填")
	}
	switch input.Target {
	case "active":
		evidence := input.Evidence
		if evidence == nil {
			return invalid("product_feature_activation_evidence_required", "生效或恢复必须提供能力证据")
		}
		switch evidence.Kind {
		case "legacy":
			if !validText(evidence.Description, 10000) || evidence.ReleaseBizID != "" {
				return invalid("product_feature_activation_evidence_invalid", "请明确描述存量能力证据")
			}
		case "release":
			release, err := uuid.Parse(evidence.ReleaseBizID)
			if err != nil || release.String() != evidence.ReleaseBizID || evidence.Description != "" {
				return invalid("product_feature_activation_evidence_invalid", "请引用有效发布记录")
			}
		default:
			return invalid("product_feature_activation_evidence_invalid", "能力证据类型无效")
		}
	case "deprecated":
		if input.Evidence != nil {
			return invalid("product_feature_activation_evidence_invalid", "弃用操作不得覆盖原能力证据")
		}
	default:
		return invalid("product_feature_lifecycle_invalid", "目标生命周期无效")
	}
	return nil
}

// This is the transition gate only. Callers must authorize current membership
// and validate release evidence within the same product transaction.
func ValidateFeatureLifecycleTransition(current, target string, isManager bool) error {
	if !isManager {
		return invalid("product_feature_manager_required", "生命周期变更需产品负责人确认")
	}
	if (current == "candidate" && target == "active") || (current == "active" && target == "deprecated") || (current == "deprecated" && target == "active") {
		return nil
	}
	return invalid("product_feature_lifecycle_conflict", "当前生命周期不允许此操作，请重新读取")
}
