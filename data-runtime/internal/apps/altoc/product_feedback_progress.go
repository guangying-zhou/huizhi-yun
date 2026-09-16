package altoc

import (
	"bytes"
	"encoding/json"
	"io"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

// Separate from the immutable six-field status.v1 command. New progress
// operations carry the complete snapshot, including an explicitly empty list.
type ProductFeedbackProgress struct {
	ProductFeedbackStatus
	CanonicalDecisionStatus string                           `json:"canonicalDecisionStatus"`
	Versions                []ProductFeedbackVersionProgress `json:"versions"`
}

type ProductFeedbackVersionProgress struct {
	VersionCode           string  `json:"versionCode"`
	Status                string  `json:"status"`
	PlannedReleaseDate    *string `json:"plannedReleaseDate"`
	ReleasedAt            *string `json:"releasedAt"`
	PublicFeatureCount    uint64  `json:"publicFeatureCount"`
	DeliveredFeatureCount uint64  `json:"deliveredFeatureCount"`
}

func parseProductFeedbackProgress(raw []byte) (ProductFeedbackProgress, error) {
	var out ProductFeedbackProgress
	invalid := func() (ProductFeedbackProgress, error) {
		return out, httperror.New(400, "feedback_progress_invalid", "Invalid feedback progress snapshot")
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil {
		return invalid()
	}
	keys := []string{"ticketCode", "productCode", "requestBizId", "canonicalRequestBizId", "decisionStatus", "sourceRevision", "canonicalDecisionStatus", "versions"}
	if len(fields) != len(keys) {
		return invalid()
	}
	for _, key := range keys {
		value, ok := fields[key]
		if !ok || bytes.Equal(bytes.TrimSpace(value), []byte("null")) {
			return invalid()
		}
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&out); err != nil {
		return invalid()
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return invalid()
	}
	text := func(value string, limit int) bool {
		return value != "" && strings.TrimSpace(value) == value && utf8.ValidString(value) && utf8.RuneCountInString(value) <= limit && !strings.ContainsFunc(value, unicode.IsControl) && !strings.ContainsAny(value, `/\`)
	}
	if !text(out.TicketCode, 30) || !text(out.ProductCode, 64) || !integrationoperation.IsValidOperationID(out.RequestBizID) || !integrationoperation.IsValidOperationID(out.CanonicalRequestBizID) || out.SourceRevision == 0 || out.SourceRevision > 9007199254740991 {
		return invalid()
	}
	switch out.CanonicalDecisionStatus {
	case "submitted", "evaluating", "accepted", "deferred", "rejected":
	default:
		return invalid()
	}
	if out.RequestBizID == out.CanonicalRequestBizID {
		if out.DecisionStatus != out.CanonicalDecisionStatus {
			return invalid()
		}
	} else if out.DecisionStatus != "merged" {
		return invalid()
	}
	if out.Versions == nil || len(out.Versions) > 1000 {
		return invalid()
	}
	// Require every nested field, including nullable dates, to distinguish absence
	// from a deliberate clearing of previously projected dates.
	var versions []map[string]json.RawMessage
	if err := json.Unmarshal(fields["versions"], &versions); err != nil {
		return invalid()
	}
	seen := map[string]bool{}
	for i, v := range out.Versions {
		if len(versions[i]) != 6 || !text(v.VersionCode, 64) || seen[v.VersionCode] || v.PublicFeatureCount == 0 || v.PublicFeatureCount > 9007199254740991 || v.DeliveredFeatureCount > v.PublicFeatureCount {
			return invalid()
		}
		seen[v.VersionCode] = true
		for _, key := range []string{"versionCode", "status", "plannedReleaseDate", "releasedAt", "publicFeatureCount", "deliveredFeatureCount"} {
			if _, ok := versions[i][key]; !ok {
				return invalid()
			}
		}
		for _, key := range []string{"versionCode", "status", "publicFeatureCount", "deliveredFeatureCount"} {
			if bytes.Equal(bytes.TrimSpace(versions[i][key]), []byte("null")) {
				return invalid()
			}
		}
		switch v.Status {
		case "planning", "developing", "released", "archived":
		default:
			return invalid()
		}
		for layout, value := range map[string]*string{"2006-01-02": v.PlannedReleaseDate, "2006-01-02 15:04:05": v.ReleasedAt} {
			if value != nil {
				parsed, err := time.Parse(layout, *value)
				if err != nil || parsed.Format(layout) != *value {
					return invalid()
				}
			}
		}
	}
	return out, nil
}
