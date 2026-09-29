// Package jsoncontract holds the executable shape contracts of JSON columns
// that are copied verbatim by the unified-enterprise migration. Writers use the
// same validators to refuse a payload on write that the cutover gate would
// later block, so "every copied JSON column has an executable contract" holds
// at both ends. Validators are structure-only and never log values.
package jsoncontract

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"math"
	"strconv"
	"strings"
	"unicode/utf8"
)

// decode parses exactly one JSON value, keeping numbers as json.Number so that
// integers are never silently converted to floats.
func decode(raw []byte) (any, bool) {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var value any
	if err := decoder.Decode(&value); err != nil {
		return nil, false
	}
	if _, err := decoder.Token(); err != io.EOF {
		return nil, false
	}
	return value, true
}

func object(value any) (map[string]any, bool) {
	result, ok := value.(map[string]any)
	return result, ok && result != nil
}

func array(value any) ([]any, bool) {
	result, ok := value.([]any)
	return result, ok && result != nil
}

func runes(text string) int { return utf8.RuneCountInString(text) }

func text(value any, max int) bool {
	s, ok := value.(string)
	return ok && s != "" && runes(s) <= max
}

func optionalText(value any, max int) bool {
	if value == nil {
		return true
	}
	s, ok := value.(string)
	return ok && runes(s) <= max
}

func integer(value any) (int64, bool) {
	number, ok := value.(json.Number)
	if !ok {
		return 0, false
	}
	parsed, err := strconv.ParseInt(number.String(), 10, 64)
	return parsed, err == nil
}

func positiveInt(value any) bool {
	parsed, ok := integer(value)
	return ok && parsed > 0
}

func nonNegativeInt(value any) bool {
	parsed, ok := integer(value)
	return ok && parsed >= 0
}

func boolean(value any) bool {
	_, ok := value.(bool)
	return ok
}

func hex64(value any) bool {
	s, ok := value.(string)
	if !ok || len(s) != 64 {
		return false
	}
	for _, c := range s {
		if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f') {
			return false
		}
	}
	return true
}

// scalar accepts what a database driver may hand back for a frozen row value:
// a string or a number. Both spellings occur in stored snapshots.
func scalar(value any) bool {
	switch value.(type) {
	case string, json.Number:
		return true
	}
	return false
}

func keysWithin(m map[string]any, required []string, optional []string) bool {
	allowed := make(map[string]bool, len(required)+len(optional))
	for _, key := range required {
		if _, ok := m[key]; !ok {
			return false
		}
		allowed[key] = true
	}
	for _, key := range optional {
		allowed[key] = true
	}
	for key := range m {
		if !allowed[key] {
			return false
		}
	}
	return true
}

func contains(list []string, key string) bool {
	for _, item := range list {
		if item == key {
			return true
		}
	}
	return false
}

// StringList is a non-null array of non-empty strings of at most 255 runes.
func StringList(raw []byte) bool {
	value, ok := decode(raw)
	if !ok {
		return false
	}
	items, ok := array(value)
	if !ok {
		return false
	}
	for _, item := range items {
		if !text(item, 255) {
			return false
		}
	}
	return true
}

const (
	AccessWhitelistMaxEntries = 1000
	AccessWhitelistMaxRunes   = 128
)

// AccessWhitelist is a JSON array of unique, trimmed, non-empty uid strings.
func AccessWhitelist(raw []byte) bool {
	value, ok := decode(raw)
	if !ok {
		return false
	}
	items, ok := array(value)
	if !ok || len(items) > AccessWhitelistMaxEntries {
		return false
	}
	seen := make(map[string]bool, len(items))
	for _, item := range items {
		uid, ok := item.(string)
		if !ok || uid == "" || runes(uid) > AccessWhitelistMaxRunes || uid != strings.TrimSpace(uid) || seen[uid] {
			return false
		}
		seen[uid] = true
	}
	return true
}

var moduleConfigBooleanKeys = []string{
	"decomposition", "environments", "milestones", "releases", "requirements", "service_desk", "workflows",
	// Read by the Aims frontend as legacy aliases of milestones/workflows
	// (aims/app/utils/projectModuleConfig.ts).
	"milestonesEnabled", "processAuditEnabled",
}

var moduleConfigStringKeys = []string{"legacyProjectType", "legacySource"}

// ProjectModuleConfig is a flat object over a closed key set: feature toggles
// (booleans) and the two migration provenance keys (strings of at most 64 runes).
func ProjectModuleConfig(raw []byte) bool {
	value, ok := decode(raw)
	if !ok {
		return false
	}
	config, ok := object(value)
	if !ok {
		return false
	}
	for key, entry := range config {
		switch {
		case contains(moduleConfigBooleanKeys, key):
			if !boolean(entry) {
				return false
			}
		case contains(moduleConfigStringKeys, key):
			s, isText := entry.(string)
			if !isText || runes(s) > 64 {
				return false
			}
		default:
			return false
		}
	}
	return true
}

const (
	EventDataMaxBytes = 64 << 10
	EventDataMaxDepth = 8
	EventDataMaxKey   = 64
)

// EventData is an open event payload validated structurally only.
func EventData(raw []byte) bool {
	var compact bytes.Buffer
	if err := json.Compact(&compact, raw); err != nil || compact.Len() > EventDataMaxBytes {
		return false
	}
	value, ok := decode(raw)
	if !ok {
		return false
	}
	top, ok := object(value)
	if !ok {
		return false
	}
	return openValue(top, 1)
}

// openValue walks the payload; depth counts nested objects and arrays only,
// so a scalar leaf never adds a level.
func openValue(value any, depth int) bool {
	switch typed := value.(type) {
	case map[string]any:
		if depth > EventDataMaxDepth {
			return false
		}
		for key, entry := range typed {
			if key == "" || runes(key) > EventDataMaxKey || !openValue(entry, depth+1) {
				return false
			}
		}
	case []any:
		if depth > EventDataMaxDepth {
			return false
		}
		for _, entry := range typed {
			if !openValue(entry, depth+1) {
				return false
			}
		}
	case json.Number:
		parsed, err := strconv.ParseFloat(typed.String(), 64)
		return err == nil && !math.IsNaN(parsed) && !math.IsInf(parsed, 0)
	}
	return true
}

// ApprovalSnapshot validates aims.milestone-completion-request.v1.
func ApprovalSnapshot(raw []byte) bool {
	value, ok := decode(raw)
	if !ok {
		return false
	}
	snapshot, ok := object(value)
	if !ok || !keysWithin(snapshot, []string{"schema", "project", "milestone", "deliverables", "workItems"}, nil) || snapshot["schema"] != "aims.milestone-completion-request.v1" {
		return false
	}
	project, ok := object(snapshot["project"])
	if !ok || !keysWithin(project, []string{"id", "code"}, nil) || !positiveInt(project["id"]) || !text(project["code"], 191) {
		return false
	}
	milestone, ok := object(snapshot["milestone"])
	if !ok || !keysWithin(milestone, []string{"id", "name", "status", "sortOrder"}, nil) || !positiveInt(milestone["id"]) || !text(milestone["name"], 500) || !text(milestone["status"], 64) {
		return false
	}
	if _, ok := integer(milestone["sortOrder"]); !ok {
		return false
	}
	deliverables, ok := array(snapshot["deliverables"])
	if !ok {
		return false
	}
	for _, entry := range deliverables {
		item, ok := object(entry)
		if !ok || !keysWithin(item, []string{"id", "name", "deliverable_type", "required", "status", "quality_status", "current_submission_id", "document_uuid", "effective_milestone_id", "active_waiver_id"}, nil) {
			return false
		}
		for _, key := range []string{"id", "name", "deliverable_type", "required", "status"} {
			if !scalar(item[key]) {
				return false
			}
		}
		// Nullable source columns.
		for _, key := range []string{"quality_status", "current_submission_id", "document_uuid", "effective_milestone_id", "active_waiver_id"} {
			if item[key] != nil && !scalar(item[key]) {
				return false
			}
		}
	}
	workItems, ok := array(snapshot["workItems"])
	if !ok {
		return false
	}
	for _, entry := range workItems {
		item, ok := object(entry)
		if !ok || !keysWithin(item, []string{"id", "item_key", "tier", "type", "title", "status", "assignee_uid"}, []string{"updated_at"}) {
			return false
		}
		for _, key := range []string{"id", "item_key", "tier", "type", "title", "status", "assignee_uid"} {
			if !scalar(item[key]) {
				return false
			}
		}
		if item["updated_at"] != nil && !scalar(item["updated_at"]) {
			return false
		}
	}
	return true
}

// CanonicalSHA256 recomputes the writer's hash: a compact, key-sorted
// re-marshal of the stored JSON. It reports false for invalid JSON.
func CanonicalSHA256(raw []byte) (string, bool) {
	value, ok := decode(raw)
	if !ok {
		return "", false
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return "", false
	}
	sum := sha256.Sum256(encoded)
	return hex.EncodeToString(sum[:]), true
}

// QualityReviewResult validates aims.deliverable-quality-review.v1.
func QualityReviewResult(raw []byte) bool {
	value, ok := decode(raw)
	if !ok {
		return false
	}
	review, ok := object(value)
	if !ok || !keysWithin(review, []string{"schema", "stage", "checklistVersionId", "checklistItemsSha256", "results"}, nil) || review["schema"] != "aims.deliverable-quality-review.v1" {
		return false
	}
	if review["stage"] != "pm_completeness" && review["stage"] != "director_quality" {
		return false
	}
	if !positiveInt(review["checklistVersionId"]) || !hex64(review["checklistItemsSha256"]) {
		return false
	}
	results, ok := array(review["results"])
	if !ok {
		return false
	}
	seen := map[string]bool{}
	for _, entry := range results {
		result, ok := object(entry)
		if !ok || !keysWithin(result, []string{"code", "label", "passed"}, nil) || !text(result["code"], 128) || !optionalText(result["label"], 500) || !boolean(result["passed"]) {
			return false
		}
		code := result["code"].(string)
		if seen[code] {
			return false
		}
		seen[code] = true
	}
	return true
}

// SubmissionEvidence validates aims.deliverable-submission.evidence.v2.
func SubmissionEvidence(raw []byte) bool {
	value, ok := decode(raw)
	if !ok {
		return false
	}
	evidence, ok := object(value)
	if !ok || evidence["schema"] != "aims.deliverable-submission.evidence.v2" {
		return false
	}
	required := []string{"schema", "deliverableId", "documentSource", "contentSha256", "checklistVersionId", "checklistItemsSha256"}
	switch evidence["documentSource"] {
	case "codocs":
		required = append(required, "documentUuid", "documentVersionId", "documentVersionNum")
	case "repo":
		required = append(required, "repoProjectCode", "repoFilePath", "repoCommitId")
	default:
		return false
	}
	if !keysWithin(evidence, required, nil) {
		return false
	}
	if !positiveInt(evidence["deliverableId"]) || !positiveInt(evidence["checklistVersionId"]) || !hex64(evidence["contentSha256"]) || !hex64(evidence["checklistItemsSha256"]) {
		return false
	}
	if evidence["documentSource"] == "codocs" {
		return text(evidence["documentUuid"], 64) && positiveInt(evidence["documentVersionId"]) && positiveInt(evidence["documentVersionNum"])
	}
	return text(evidence["repoProjectCode"], 191) && text(evidence["repoFilePath"], 1024) && text(evidence["repoCommitId"], 255)
}

// TemplateDefinition validates the project template version structure:
// milestones -> workItems -> deliverables. Null lists and null descriptions
// are what the Go writer emits for empty values and are accepted. A milestone
// may also omit description: legacy template versions written before the Go
// writer never had the key.
func TemplateDefinition(raw []byte) bool {
	value, ok := decode(raw)
	if !ok {
		return false
	}
	definition, ok := object(value)
	if !ok || !keysWithin(definition, []string{"milestones"}, nil) {
		return false
	}
	return templateList(definition["milestones"], func(entry any) bool {
		milestone, ok := object(entry)
		if !ok || !keysWithin(milestone, []string{"key", "name", "mode", "pivrStage", "sortOrder", "workItems"}, []string{"description", "recurrenceRule"}) {
			return false
		}
		if !text(milestone["key"], 191) || !text(milestone["name"], 500) || !optionalText(milestone["description"], 10000) ||
			!optionalText(milestone["mode"], 64) || !optionalText(milestone["pivrStage"], 64) || !optionalText(milestone["recurrenceRule"], 255) {
			return false
		}
		if _, ok := integer(milestone["sortOrder"]); !ok {
			return false
		}
		return templateList(milestone["workItems"], templateWorkItem)
	})
}

// templateList accepts a null list or an array whose entries all pass check.
func templateList(value any, check func(any) bool) bool {
	if value == nil {
		return true
	}
	items, ok := array(value)
	if !ok {
		return false
	}
	for _, item := range items {
		if !check(item) {
			return false
		}
	}
	return true
}

func templateWorkItem(entry any) bool {
	item, ok := object(entry)
	if !ok || !keysWithin(item, []string{"key", "title", "type", "tier", "description", "required", "reviewLevel", "priority", "sortOrder", "deliverables"}, nil) {
		return false
	}
	if !text(item["key"], 191) || !text(item["title"], 500) || !optionalText(item["type"], 64) || !optionalText(item["tier"], 64) ||
		!optionalText(item["description"], 10000) || !optionalText(item["priority"], 64) || !boolean(item["required"]) {
		return false
	}
	if !nonNegativeInt(item["reviewLevel"]) {
		return false
	}
	if _, ok := integer(item["sortOrder"]); !ok {
		return false
	}
	return templateList(item["deliverables"], templateDeliverable)
}

func templateDeliverable(entry any) bool {
	item, ok := object(entry)
	if !ok || !keysWithin(item, []string{"key", "name", "description", "acceptanceCriteria", "deliverableType", "required", "sortOrder"}, nil) {
		return false
	}
	if !text(item["key"], 191) || !text(item["name"], 500) || !optionalText(item["description"], 10000) ||
		!optionalText(item["acceptanceCriteria"], 10000) || !optionalText(item["deliverableType"], 64) || !boolean(item["required"]) {
		return false
	}
	_, ok = integer(item["sortOrder"])
	return ok
}

// QAChecklistItems is a non-empty array of {code,label,required} with unique codes.
func QAChecklistItems(raw []byte) bool {
	value, ok := decode(raw)
	if !ok {
		return false
	}
	items, ok := array(value)
	if !ok || len(items) == 0 {
		return false
	}
	seen := map[string]bool{}
	for _, entry := range items {
		item, ok := object(entry)
		if !ok || !keysWithin(item, []string{"code", "label", "required"}, nil) || !text(item["code"], 128) || !text(item["label"], 500) || !boolean(item["required"]) {
			return false
		}
		code := item["code"].(string)
		if seen[code] {
			return false
		}
		seen[code] = true
	}
	return true
}

const AttachmentsMaxEntries = 50

// Attachments is an array of {name,url} objects with non-empty bounded strings.
func Attachments(raw []byte) bool {
	value, ok := decode(raw)
	if !ok {
		return false
	}
	items, ok := array(value)
	if !ok || len(items) > AttachmentsMaxEntries {
		return false
	}
	for _, entry := range items {
		item, ok := object(entry)
		if !ok || !keysWithin(item, []string{"name", "url"}, nil) || !text(item["name"], 255) || !text(item["url"], 2048) {
			return false
		}
	}
	return true
}
