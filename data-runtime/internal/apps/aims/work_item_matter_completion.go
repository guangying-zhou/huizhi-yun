package aims

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// The standalone execution page requires evidence for every required output,
// one recorded time entry, and a linked commit whenever code output exists.
// Keep this query limited to the frozen evidence consumed by that rule.
func matterCompletionEvidence(ctx context.Context, q aimsQueryer, item map[string]any, lock bool) (map[string]any, string, error) {
	itemID := fmt.Sprint(item["id"])
	projectID := fmt.Sprint(item["project_id"])
	suffix := ""
	if lock {
		suffix = " FOR UPDATE"
	}
	deliverables, err := aimsQueryMaps(ctx, q, `SELECT id,deliverable_type,required,status,document_source,document_uuid,
		repo_project_code,repo_file_path,evidence_url,evidence_note FROM deliverables
		WHERE matter_id=? AND project_id=? ORDER BY id`+suffix, itemID, projectID)
	if err != nil {
		return nil, "", err
	}
	commits, err := aimsQueryMaps(ctx, q, `SELECT id,repo_project_code,commit_sha FROM gitlab_commits
		WHERE work_item_id=? AND project_id=? ORDER BY id`+suffix, itemID, projectID)
	if err != nil {
		return nil, "", err
	}
	timeEntries, err := aimsQueryMaps(ctx, q, `SELECT id,hours,row_version FROM time_entries
		WHERE work_item_id=? AND project_id=? ORDER BY id`+suffix, itemID, projectID)
	if err != nil {
		return nil, "", err
	}
	evidence := map[string]any{"deliverables": deliverables, "commits": commits, "timeEntries": timeEntries}
	raw, err := json.Marshal(evidence)
	if err != nil {
		return nil, "", err
	}
	sum := sha256.Sum256(raw)
	return evidence, hex.EncodeToString(sum[:]), nil
}

func validateMatterCompletionReady(item map[string]any, evidence map[string]any) error {
	if aimsMapText(item, "tier") != "matter" || aimsMapText(item, "type") == "requirement" || aimsMapText(item, "status") != "in_progress" {
		return httperror.New(409, "work_item_completion_state_invalid", "Only an in-progress non-requirement matter can request completion")
	}
	deliverables, _ := evidence["deliverables"].([]map[string]any)
	commits, _ := evidence["commits"].([]map[string]any)
	timeEntries, _ := evidence["timeEntries"].([]map[string]any)
	if len(timeEntries) == 0 {
		return httperror.New(409, "matter_completion_time_required", "Record work time before requesting completion")
	}
	for _, d := range deliverables {
		kind := aimsMapText(d, "deliverable_type")
		if kind == "code" && len(commits) == 0 {
			return httperror.New(409, "matter_completion_commit_required", "Code output requires a linked commit")
		}
		if serviceBodyInt(d, "required") == 0 {
			continue
		}
		switch kind {
		case "document":
			if aimsMapText(d, "document_source") == "repo" {
				if strings.TrimSpace(aimsMapText(d, "repo_project_code")) != "" && strings.TrimSpace(aimsMapText(d, "repo_file_path")) != "" {
					continue
				}
			} else if strings.TrimSpace(aimsMapText(d, "document_uuid")) != "" {
				continue
			}
		case "code":
			if len(commits) > 0 {
				continue
			}
		default:
			if aimsMapText(d, "status") != "pending" || strings.TrimSpace(aimsMapText(d, "evidence_url")) != "" || strings.TrimSpace(aimsMapText(d, "evidence_note")) != "" {
				continue
			}
		}
		return httperror.New(409, "matter_completion_evidence_required", "Required output evidence is incomplete")
	}
	return nil
}

func matterCompletionSnapshotTx(ctx context.Context, tx *sql.Tx, item map[string]any) (map[string]any, string, error) {
	evidence, _, err := matterCompletionEvidence(ctx, tx, item, true)
	if err != nil {
		return nil, "", err
	}
	if err := validateMatterCompletionReady(item, evidence); err != nil {
		return nil, "", err
	}
	snapshot := map[string]any{"kind": "matter", "item": item, "evidence": evidence}
	raw, err := json.Marshal(snapshot)
	if err != nil {
		return nil, "", err
	}
	sum := sha256.Sum256(raw)
	return snapshot, hex.EncodeToString(sum[:]), nil
}

func matterCompletionEvidenceSummary(snapshot map[string]any) map[string]any {
	evidence, _ := snapshot["evidence"].(map[string]any)
	entries := func(value any) []map[string]any {
		if rows, ok := value.([]map[string]any); ok {
			return rows
		}
		values, ok := value.([]any)
		if !ok {
			return nil
		}
		var rows []map[string]any
		for _, value := range values {
			row, _ := value.(map[string]any)
			rows = append(rows, row)
		}
		return rows
	}
	deliverables := entries(evidence["deliverables"])
	commits := entries(evidence["commits"])
	timeEntries := entries(evidence["timeEntries"])
	required := 0
	for _, deliverable := range deliverables {
		if serviceBodyInt(deliverable, "required") != 0 {
			required++
		}
	}
	return map[string]any{"deliverableCount": len(deliverables), "requiredDeliverableCount": required, "commitCount": len(commits), "timeEntryCount": len(timeEntries)}
}
