package altoc

import (
	"context"
	"database/sql"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type contractProjectRelationInput struct {
	lineCodes           []string
	lineIDs             []int64
	lineRelations       []contractProjectLineRelationInput
	obligationCodes     []string
	obligationIDs       []int64
	obligationRelations []contractProjectObligationRelationInput
	explicit            bool
}

type contractProjectLineRelationInput struct {
	lineCode         string
	lineID           int64
	relationType     string
	allocationMethod string
	allocationRatio  any
	allocatedAmount  any
	plannedWorkdays  any
}

type contractProjectObligationRelationInput struct {
	obligationCode string
	obligationID   int64
}

type resolvedContractProjectLineRelation struct {
	lineID           int64
	relationType     string
	allocationMethod string
	allocationRatio  any
	allocatedAmount  any
	plannedWorkdays  any
}

func (a *Adapter) handleContractProjectLinkRuntime(ctx context.Context, method string, contractIDText string, linkIDText string, query url.Values, body map[string]any) (any, string, error) {
	contractID, err := altocIdentifierID(contractIDText, "contract_id")
	if err != nil {
		return nil, "", err
	}
	switch method {
	case http.MethodGet:
		if strings.TrimSpace(linkIDText) == "" {
			data, err := a.listContractProjectLinksRuntime(ctx, contractID)
			return runtimeOK(data), "altoc.contracts.project_links.list", err
		}
		linkID, err := altocIdentifierID(linkIDText, "contract_project_link_id")
		if err != nil {
			return nil, "", err
		}
		data, err := a.getContractProjectLinkRuntime(ctx, contractID, linkID)
		return runtimeOK(data), "altoc.contracts.project_links.get", err
	case http.MethodPost:
		if strings.TrimSpace(linkIDText) != "" {
			return nil, "", httperror.New(http.StatusNotFound, "record_not_found", "contract project link route not found")
		}
		data, err := a.upsertContractProjectLinkFromBody(ctx, contractID, body)
		return runtimeOK(data), "altoc.contracts.project_links.create", err
	case http.MethodPut, http.MethodPatch:
		linkID, err := altocIdentifierID(linkIDText, "contract_project_link_id")
		if err != nil {
			return nil, "", err
		}
		data, err := a.updateContractProjectLinkFromBody(ctx, contractID, linkID, body)
		return runtimeOK(data), "altoc.contracts.project_links.update", err
	case http.MethodDelete:
		linkID, err := altocIdentifierID(linkIDText, "contract_project_link_id")
		if err != nil {
			return nil, "", err
		}
		data, err := a.deleteContractProjectLinkRuntime(ctx, contractID, linkID, body)
		return runtimeOK(data), "altoc.contracts.project_links.delete", err
	default:
		return nil, "", httperror.New(http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
	}
}

func (a *Adapter) listContractProjectLinksRuntime(ctx context.Context, contractID int64) (map[string]any, error) {
	items, err := a.contractProjectLinks(ctx, a.DB(), contractID)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"items":    items,
		"total":    len(items),
		"page":     1,
		"pageSize": len(items),
	}, nil
}

func (a *Adapter) getContractProjectLinkRuntime(ctx context.Context, contractID int64, linkID int64) (map[string]any, error) {
	link, err := altocQueryOneMap(ctx, a.DB(), `
		SELECT *
		FROM contract_project_link
		WHERE id = ?
		  AND contract_id = ?
		  AND deleted_at IS NULL
		LIMIT 1
	`, linkID, contractID)
	if err != nil {
		return nil, err
	}
	if link == nil {
		return nil, httperror.New(http.StatusNotFound, "record_not_found", "contract project link not found")
	}
	if err := a.enrichContractProjectLink(ctx, a.DB(), link); err != nil {
		return nil, err
	}
	return link, nil
}

func (a *Adapter) upsertContractProjectLinkFromBody(ctx context.Context, contractID int64, body map[string]any) (map[string]any, error) {
	projectCode := firstBodyText(body, "project_code", "projectCode", "aims_project_code", "aimsProjectCode")
	if strings.TrimSpace(projectCode) == "" {
		return nil, httperror.New(http.StatusBadRequest, "project_code_required", "project_code is required")
	}
	projectRole := firstNonEmptyText(firstBodyText(body, "project_role", "projectRole"), "delivery")
	linkMode := firstNonEmptyText(firstBodyText(body, "link_mode", "linkMode"), "linked_existing")
	operator := altocActor(body)
	input := contractProjectRelationInputFromBody(body)

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	contract, err := lockContractByIDTx(ctx, tx, contractID)
	if err != nil {
		return nil, err
	}
	if contract == nil {
		return nil, httperror.New(http.StatusNotFound, "contract_not_found", "contract not found")
	}
	if !input.explicit {
		inferred, err := a.inferContractProjectRelationsTx(ctx, tx, contractID, projectRole)
		if err != nil {
			return nil, err
		}
		input = inferred
	}

	lineCodesJSON := nullableJSONStringArray(input.lineCodes)
	obligationCodesJSON := nullableJSONStringArray(input.obligationCodes)
	primaryLineID := contractProjectSingleID(input.lineIDs)
	primaryObligationID := contractProjectSingleID(input.obligationIDs)

	_, err = tx.ExecContext(ctx, `
		INSERT INTO contract_project_link (
		  contract_id,
		  contract_line_id,
		  obligation_id,
		  project_code,
		  project_name_snapshot,
		  project_role,
		  plan_key,
		  line_codes_json,
		  obligation_codes_json,
		  link_mode,
		  status,
		  created_by,
		  updated_by
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON DUPLICATE KEY UPDATE
		  contract_line_id = COALESCE(VALUES(contract_line_id), contract_line_id),
		  obligation_id = COALESCE(VALUES(obligation_id), obligation_id),
		  project_name_snapshot = COALESCE(VALUES(project_name_snapshot), project_name_snapshot),
		  plan_key = COALESCE(VALUES(plan_key), plan_key),
		  line_codes_json = COALESCE(VALUES(line_codes_json), line_codes_json),
		  obligation_codes_json = COALESCE(VALUES(obligation_codes_json), obligation_codes_json),
		  link_mode = VALUES(link_mode),
		  status = VALUES(status),
		  updated_by = VALUES(updated_by),
		  updated_at = CURRENT_TIMESTAMP,
		  deleted_at = NULL
	`, contractID,
		nullablePositiveInt64(primaryLineID),
		nullablePositiveInt64(primaryObligationID),
		projectCode,
		nullableText(firstBodyText(body, "project_name_snapshot", "projectNameSnapshot", "project_name", "projectName")),
		projectRole,
		nullableText(firstBodyText(body, "plan_key", "planKey")),
		lineCodesJSON,
		obligationCodesJSON,
		linkMode,
		firstNonEmptyText(firstBodyText(body, "status"), "active"),
		nullableText(operator),
		nullableText(operator),
	)
	if err != nil {
		return nil, err
	}
	link, err := contractProjectLinkByKeyTx(ctx, tx, contractID, projectCode, projectRole)
	if err != nil {
		return nil, err
	}
	if link == nil {
		return nil, httperror.New(http.StatusInternalServerError, "contract_project_link_missing", "contract project link was not persisted")
	}
	if err := a.syncContractProjectStructuredRelationsTx(ctx, tx, contractID, link, projectRole, input, true, body); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return a.getContractProjectLinkRuntime(ctx, contractID, altocPositiveID(link["id"]))
}

func (a *Adapter) updateContractProjectLinkFromBody(ctx context.Context, contractID int64, linkID int64, body map[string]any) (map[string]any, error) {
	operator := altocActor(body)
	input := contractProjectRelationInputFromBody(body)

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	link, err := lockContractProjectLinkTx(ctx, tx, contractID, linkID)
	if err != nil {
		return nil, err
	}
	if link == nil {
		return nil, httperror.New(http.StatusNotFound, "record_not_found", "contract project link not found")
	}
	projectRole := firstNonEmptyText(firstBodyText(body, "project_role", "projectRole"), altocMapText(link, "project_role"), "delivery")
	if !input.explicit {
		input = contractProjectRelationInput{}
	}

	set := []string{
		"updated_by = ?",
		"updated_at = CURRENT_TIMESTAMP",
	}
	args := []any{nullableText(operator)}
	if value := firstBodyText(body, "project_name_snapshot", "projectNameSnapshot", "project_name", "projectName"); value != "" {
		set = append(set, "project_name_snapshot = ?")
		args = append(args, value)
	}
	if value := firstBodyText(body, "project_role", "projectRole"); value != "" {
		set = append(set, "project_role = ?")
		args = append(args, value)
	}
	if value := firstBodyText(body, "plan_key", "planKey"); value != "" {
		set = append(set, "plan_key = ?")
		args = append(args, value)
	}
	if value := firstBodyText(body, "link_mode", "linkMode"); value != "" {
		set = append(set, "link_mode = ?")
		args = append(args, value)
	}
	if value := firstBodyText(body, "status"); value != "" {
		set = append(set, "status = ?")
		args = append(args, value)
	}
	if input.explicit {
		set = append(set, "line_codes_json = ?", "obligation_codes_json = ?")
		args = append(args, nullableJSONStringArray(input.lineCodes), nullableJSONStringArray(input.obligationCodes))
	}
	args = append(args, linkID)
	if _, err := tx.ExecContext(ctx, "UPDATE contract_project_link SET "+strings.Join(set, ", ")+" WHERE id = ?", args...); err != nil {
		return nil, err
	}
	link, err = lockContractProjectLinkTx(ctx, tx, contractID, linkID)
	if err != nil {
		return nil, err
	}
	if input.explicit {
		if err := a.syncContractProjectStructuredRelationsTx(ctx, tx, contractID, link, projectRole, input, true, body); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return a.getContractProjectLinkRuntime(ctx, contractID, linkID)
}

func (a *Adapter) deleteContractProjectLinkRuntime(ctx context.Context, contractID int64, linkID int64, body map[string]any) (map[string]any, error) {
	operator := altocActor(body)
	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	link, err := lockContractProjectLinkTx(ctx, tx, contractID, linkID)
	if err != nil {
		return nil, err
	}
	if link == nil {
		return nil, httperror.New(http.StatusNotFound, "record_not_found", "contract project link not found")
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE contract_project_line_rel
		SET deleted_at = CURRENT_TIMESTAMP,
		    updated_by = ?,
		    updated_at = CURRENT_TIMESTAMP
		WHERE contract_project_link_id = ?
		  AND deleted_at IS NULL
	`, nullableText(operator), linkID); err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE contract_project_obligation_rel
		SET deleted_at = CURRENT_TIMESTAMP,
		    updated_by = ?,
		    updated_at = CURRENT_TIMESTAMP
		WHERE contract_project_link_id = ?
		  AND deleted_at IS NULL
	`, nullableText(operator), linkID); err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE contract_project_link
		SET deleted_at = CURRENT_TIMESTAMP,
		    updated_by = ?,
		    updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, nullableText(operator), linkID); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"id": linkID, "deleted": true}, nil
}

func (a *Adapter) syncContractProjectStructuredRelationsTx(ctx context.Context, tx *sql.Tx, contractID any, link map[string]any, projectRole string, input contractProjectRelationInput, replace bool, body map[string]any) error {
	input = normalizeContractProjectRelationInput(input)
	if !input.explicit {
		return nil
	}
	linkID := altocPositiveID(link["id"])
	if linkID <= 0 {
		return nil
	}
	if exists, err := altocTableExists(ctx, tx, "contract_project_line_rel"); err != nil {
		return err
	} else if exists {
		if err := a.syncContractProjectLineRelationsTx(ctx, tx, contractID, linkID, projectRole, input, replace, body); err != nil {
			return err
		}
	}
	if exists, err := altocTableExists(ctx, tx, "contract_project_obligation_rel"); err != nil {
		return err
	} else if exists {
		if err := a.syncContractProjectObligationRelationsTx(ctx, tx, contractID, linkID, input, replace, body); err != nil {
			return err
		}
	}
	return nil
}

func (a *Adapter) syncContractProjectLineRelationsTx(ctx context.Context, tx *sql.Tx, contractID any, linkID int64, projectRole string, input contractProjectRelationInput, replace bool, body map[string]any) error {
	lineRelations, err := resolveContractProjectLineRelationsTx(ctx, tx, contractID, projectRole, input, body)
	if err != nil {
		return err
	}
	if err := validateContractProjectLineAllocation(lineRelations); err != nil {
		return err
	}
	if replace {
		if _, err := tx.ExecContext(ctx, `
			UPDATE contract_project_line_rel
			SET deleted_at = CURRENT_TIMESTAMP,
			    updated_by = ?,
			    updated_at = CURRENT_TIMESTAMP
			WHERE contract_project_link_id = ?
			  AND deleted_at IS NULL
		`, nullableText(altocActor(body)), linkID); err != nil {
			return err
		}
	}
	if len(lineRelations) == 0 {
		return nil
	}
	operator := altocActor(body)
	for _, relation := range lineRelations {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO contract_project_line_rel (
			  contract_project_link_id,
			  contract_line_id,
			  relation_type,
			  allocation_method,
			  allocation_ratio,
			  allocated_amount,
			  planned_workdays,
			  created_by,
			  updated_by
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON DUPLICATE KEY UPDATE
			  allocation_method = VALUES(allocation_method),
			  allocation_ratio = VALUES(allocation_ratio),
			  allocated_amount = VALUES(allocated_amount),
			  planned_workdays = VALUES(planned_workdays),
			  deleted_at = NULL,
			  updated_by = VALUES(updated_by),
			  updated_at = CURRENT_TIMESTAMP
		`, linkID,
			relation.lineID,
			relation.relationType,
			relation.allocationMethod,
			relation.allocationRatio,
			relation.allocatedAmount,
			relation.plannedWorkdays,
			nullableText(operator),
			nullableText(operator)); err != nil {
			return err
		}
	}
	return nil
}

func (a *Adapter) syncContractProjectObligationRelationsTx(ctx context.Context, tx *sql.Tx, contractID any, linkID int64, input contractProjectRelationInput, replace bool, body map[string]any) error {
	obligationIDs, err := resolveContractProjectObligationIDsTx(ctx, tx, contractID, input)
	if err != nil {
		return err
	}
	operator := altocActor(body)
	if replace {
		if _, err := tx.ExecContext(ctx, `
			UPDATE contract_project_obligation_rel
			SET deleted_at = CURRENT_TIMESTAMP,
			    updated_by = ?,
			    updated_at = CURRENT_TIMESTAMP
			WHERE contract_project_link_id = ?
			  AND deleted_at IS NULL
		`, nullableText(operator), linkID); err != nil {
			return err
		}
	}
	for _, obligationID := range obligationIDs {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO contract_project_obligation_rel (
			  contract_project_link_id,
			  obligation_id,
			  created_by,
			  updated_by
			) VALUES (?, ?, ?, ?)
			ON DUPLICATE KEY UPDATE
			  deleted_at = NULL,
			  updated_by = VALUES(updated_by),
			  updated_at = CURRENT_TIMESTAMP
		`, linkID, obligationID, nullableText(operator), nullableText(operator)); err != nil {
			return err
		}
	}
	return nil
}

func resolveContractProjectLineRelationsTx(ctx context.Context, tx *sql.Tx, contractID any, projectRole string, input contractProjectRelationInput, body map[string]any) ([]resolvedContractProjectLineRelation, error) {
	seen := map[string]bool{}
	result := []resolvedContractProjectLineRelation{}
	missingCodes := []string{}
	missingIDs := []string{}
	mismatchRefs := []string{}
	fallbackRelationType := firstNonEmptyText(firstBodyText(body, "relation_type", "relationType"), contractProjectRelationType(projectRole))
	fallbackAllocationMethod, err := contractProjectAllocationMethod(firstBodyText(body, "allocation_method", "allocationMethod"))
	if err != nil {
		return nil, err
	}
	fallbackAllocationRatio := contractProjectOptionalDecimal(body, "allocation_ratio", "allocationRatio")
	fallbackAllocatedAmount := contractProjectOptionalDecimal(body, "allocated_amount", "allocatedAmount")
	fallbackPlannedWorkdays := contractProjectOptionalDecimal(body, "planned_workdays", "plannedWorkdays")

	for _, relation := range input.lineRelations {
		if relation.lineID <= 0 && relation.lineCode == "" {
			continue
		}
		var line map[string]any
		var err error
		if relation.lineID > 0 {
			line, err = altocQueryOneMap(ctx, tx, `
			SELECT id
			FROM contract_line
			WHERE id = ?
			  AND contract_id = ?
			  AND deleted_at IS NULL
			LIMIT 1
		`, relation.lineID, contractID)
			if err != nil {
				return nil, err
			}
			if line == nil {
				missingIDs = append(missingIDs, fmt.Sprint(relation.lineID))
				continue
			}
			if relation.lineCode != "" {
				matchingLine, err := altocQueryOneMap(ctx, tx, `
					SELECT id
					FROM contract_line
					WHERE id = ?
					  AND contract_id = ?
					  AND code = ?
					  AND deleted_at IS NULL
					LIMIT 1
				`, relation.lineID, contractID, relation.lineCode)
				if err != nil {
					return nil, err
				}
				if matchingLine == nil {
					mismatchRefs = append(mismatchRefs, fmt.Sprintf("%d/%s", relation.lineID, relation.lineCode))
					continue
				}
			}
		} else {
			line, err = altocQueryOneMap(ctx, tx, `
			SELECT id
			FROM contract_line
			WHERE contract_id = ?
			  AND code = ?
			  AND deleted_at IS NULL
			LIMIT 1
		`, contractID, relation.lineCode)
			if err != nil {
				return nil, err
			}
			if line == nil {
				missingCodes = append(missingCodes, relation.lineCode)
				continue
			}
		}
		id := altocPositiveID(line["id"])
		relationType := contractProjectRelationTypeValue(relation.relationType, fallbackRelationType)
		key := fmt.Sprintf("%d:%s", id, relationType)
		if id <= 0 || seen[key] {
			continue
		}
		seen[key] = true
		allocationMethod := relation.allocationMethod
		if allocationMethod == "" {
			allocationMethod = fallbackAllocationMethod
		}
		allocationMethod, err = contractProjectAllocationMethod(allocationMethod)
		if err != nil {
			return nil, err
		}
		result = append(result, resolvedContractProjectLineRelation{
			lineID:           id,
			relationType:     relationType,
			allocationMethod: allocationMethod,
			allocationRatio:  firstNonNil(relation.allocationRatio, fallbackAllocationRatio),
			allocatedAmount:  firstNonNil(relation.allocatedAmount, fallbackAllocatedAmount),
			plannedWorkdays:  firstNonNil(relation.plannedWorkdays, fallbackPlannedWorkdays),
		})
	}
	if len(missingCodes) > 0 || len(missingIDs) > 0 || len(mismatchRefs) > 0 {
		return nil, invalidContractProjectRefsError("line", missingCodes, missingIDs, mismatchRefs)
	}
	return result, nil
}

func resolveContractProjectObligationIDsTx(ctx context.Context, tx *sql.Tx, contractID any, input contractProjectRelationInput) ([]int64, error) {
	seen := map[int64]bool{}
	result := []int64{}
	missingCodes := []string{}
	missingIDs := []string{}
	mismatchRefs := []string{}
	for _, relation := range input.obligationRelations {
		if relation.obligationID <= 0 && relation.obligationCode == "" {
			continue
		}
		var obligation map[string]any
		var err error
		if relation.obligationID > 0 {
			obligation, err = altocQueryOneMap(ctx, tx, `
			SELECT id
			FROM contract_obligation
			WHERE id = ?
			  AND contract_id = ?
			  AND deleted_at IS NULL
			LIMIT 1
		`, relation.obligationID, contractID)
			if err != nil {
				return nil, err
			}
			if obligation == nil {
				missingIDs = append(missingIDs, fmt.Sprint(relation.obligationID))
				continue
			}
			if relation.obligationCode != "" {
				matchingObligation, err := altocQueryOneMap(ctx, tx, `
					SELECT id
					FROM contract_obligation
					WHERE id = ?
					  AND contract_id = ?
					  AND code = ?
					  AND deleted_at IS NULL
					LIMIT 1
				`, relation.obligationID, contractID, relation.obligationCode)
				if err != nil {
					return nil, err
				}
				if matchingObligation == nil {
					mismatchRefs = append(mismatchRefs, fmt.Sprintf("%d/%s", relation.obligationID, relation.obligationCode))
					continue
				}
			}
		} else {
			obligation, err = altocQueryOneMap(ctx, tx, `
			SELECT id
			FROM contract_obligation
			WHERE contract_id = ?
			  AND code = ?
			  AND deleted_at IS NULL
			LIMIT 1
		`, contractID, relation.obligationCode)
			if err != nil {
				return nil, err
			}
			if obligation == nil {
				missingCodes = append(missingCodes, relation.obligationCode)
				continue
			}
		}
		id := altocPositiveID(obligation["id"])
		if id <= 0 || seen[id] {
			continue
		}
		seen[id] = true
		result = append(result, id)
	}
	if len(missingCodes) > 0 || len(missingIDs) > 0 || len(mismatchRefs) > 0 {
		return nil, invalidContractProjectRefsError("obligation", missingCodes, missingIDs, mismatchRefs)
	}
	return result, nil
}

func (a *Adapter) inferContractProjectRelationsTx(ctx context.Context, tx *sql.Tx, contractID any, projectRole string) (contractProjectRelationInput, error) {
	lines, err := a.contractLines(ctx, tx, contractID)
	if err != nil {
		return contractProjectRelationInput{}, err
	}
	obligations, err := a.contractObligations(ctx, tx, contractID)
	if err != nil {
		return contractProjectRelationInput{}, err
	}
	obligationsByLine := activationObligationsByLineID(obligations)
	input := contractProjectRelationInput{}
	role := strings.TrimSpace(projectRole)
	for _, line := range lines {
		if strings.TrimSpace(altocMapText(line, "status")) == "cancelled" || activationPolicy(line, "project_policy") == "none" {
			continue
		}
		if activationProjectRole(line) != role {
			continue
		}
		if code := altocMapText(line, "code"); code != "" {
			input.lineCodes = append(input.lineCodes, code)
		}
		if id := altocPositiveID(line["id"]); id > 0 {
			input.lineIDs = append(input.lineIDs, id)
			for _, obligation := range obligationsByLine[fmt.Sprint(id)] {
				if code := altocMapText(obligation, "code"); code != "" {
					input.obligationCodes = append(input.obligationCodes, code)
				}
				if obligationID := altocPositiveID(obligation["id"]); obligationID > 0 {
					input.obligationIDs = append(input.obligationIDs, obligationID)
				}
			}
		}
	}
	input.lineCodes = uniqueStrings(input.lineCodes)
	input.obligationCodes = uniqueStrings(input.obligationCodes)
	input.lineIDs = uniqueInt64s(input.lineIDs)
	input.obligationIDs = uniqueInt64s(input.obligationIDs)
	for _, code := range input.lineCodes {
		input.addLineRelation(contractProjectLineRelationInput{lineCode: code})
	}
	for _, id := range input.lineIDs {
		input.addLineRelation(contractProjectLineRelationInput{lineID: id})
	}
	for _, code := range input.obligationCodes {
		input.addObligationRelation(contractProjectObligationRelationInput{obligationCode: code})
	}
	for _, id := range input.obligationIDs {
		input.addObligationRelation(contractProjectObligationRelationInput{obligationID: id})
	}
	input.lineCodes = uniqueStrings(input.lineCodes)
	input.obligationCodes = uniqueStrings(input.obligationCodes)
	input.lineIDs = uniqueInt64s(input.lineIDs)
	input.obligationIDs = uniqueInt64s(input.obligationIDs)
	input.explicit = len(input.lineCodes) > 0 || len(input.lineIDs) > 0 || len(input.obligationCodes) > 0 || len(input.obligationIDs) > 0
	return input, nil
}

func (a *Adapter) enrichContractProjectLink(ctx context.Context, conn altocQueryer, link map[string]any) error {
	lineRelations, lineCodes, err := a.contractProjectLineRelations(ctx, conn, link)
	if err != nil {
		return err
	}
	obligationRelations, obligationCodes, err := a.contractProjectObligationRelations(ctx, conn, link)
	if err != nil {
		return err
	}
	if len(lineCodes) == 0 {
		lineCodes = activationStringSlice(link["line_codes_json"])
	}
	if len(obligationCodes) == 0 {
		obligationCodes = activationStringSlice(link["obligation_codes_json"])
	}
	link["line_relations"] = lineRelations
	link["obligation_relations"] = obligationRelations
	link["line_codes"] = uniqueStrings(lineCodes)
	link["obligation_codes"] = uniqueStrings(obligationCodes)
	if encoded := nullableJSONStringArray(lineCodes); encoded != nil && len(lineRelations) > 0 {
		link["line_codes_json"] = encoded
	}
	if encoded := nullableJSONStringArray(obligationCodes); encoded != nil && len(obligationRelations) > 0 {
		link["obligation_codes_json"] = encoded
	}
	return nil
}

func (a *Adapter) contractProjectLineRelations(ctx context.Context, conn altocQueryer, link map[string]any) ([]map[string]any, []string, error) {
	exists, err := altocTableExists(ctx, conn, "contract_project_line_rel")
	if err != nil || !exists {
		return nil, nil, err
	}
	rows, err := altocQueryMaps(ctx, conn, `
		SELECT
		  rel.*,
		  cl.code AS contract_line_code,
		  cl.name AS contract_line_name,
		  cl.line_type AS contract_line_type,
		  cl.amount_tax_inclusive AS contract_line_amount
		FROM contract_project_line_rel rel
		INNER JOIN contract_line cl ON cl.id = rel.contract_line_id
		WHERE rel.contract_project_link_id = ?
		  AND rel.deleted_at IS NULL
		  AND cl.deleted_at IS NULL
		ORDER BY cl.sort_no ASC, cl.line_no ASC, cl.id ASC
	`, link["id"])
	if err != nil {
		return nil, nil, err
	}
	codes := make([]string, 0, len(rows))
	for _, row := range rows {
		if code := altocMapText(row, "contract_line_code"); code != "" {
			codes = append(codes, code)
		}
	}
	return rows, uniqueStrings(codes), nil
}

func (a *Adapter) contractProjectObligationRelations(ctx context.Context, conn altocQueryer, link map[string]any) ([]map[string]any, []string, error) {
	exists, err := altocTableExists(ctx, conn, "contract_project_obligation_rel")
	if err != nil || !exists {
		return nil, nil, err
	}
	rows, err := altocQueryMaps(ctx, conn, `
		SELECT
		  rel.*,
		  ob.code AS obligation_code,
		  ob.name AS obligation_name,
		  ob.obligation_type,
		  ob.status AS obligation_status,
		  ob.contract_line_id
		FROM contract_project_obligation_rel rel
		INNER JOIN contract_obligation ob ON ob.id = rel.obligation_id
		WHERE rel.contract_project_link_id = ?
		  AND rel.deleted_at IS NULL
		  AND ob.deleted_at IS NULL
		ORDER BY ob.sort_no ASC, ob.id ASC
	`, link["id"])
	if err != nil {
		return nil, nil, err
	}
	codes := make([]string, 0, len(rows))
	for _, row := range rows {
		if code := altocMapText(row, "obligation_code"); code != "" {
			codes = append(codes, code)
		}
	}
	return rows, uniqueStrings(codes), nil
}

func contractProjectRelationInputFromBody(body map[string]any) contractProjectRelationInput {
	input := contractProjectRelationInput{}
	for _, item := range activationMapSlice(firstNonNil(body["lines"], body["lineRelations"], body["line_relations"], body["contractLines"], body["contract_lines"])) {
		input.addLineRelation(contractProjectLineRelationInputFromBody(item))
	}
	for _, code := range uniqueStrings(append(
		activationStringSlice(firstNonNil(body["lineCodes"], body["line_codes"], body["line_codes_json"], body["contractLineCodes"], body["contract_line_codes"])),
		firstBodyText(body, "line_code", "lineCode", "contract_line_code", "contractLineCode"),
	)) {
		input.addLineRelation(contractProjectLineRelationInput{lineCode: code})
	}
	for _, id := range uniqueInt64s(append(
		contractProjectIDSlice(firstNonNil(body["lineIds"], body["line_ids"], body["contractLineIds"], body["contract_line_ids"])),
		altocPositiveID(firstNonNil(body["contractLineId"], body["contract_line_id"], body["lineId"], body["line_id"])),
	)) {
		input.addLineRelation(contractProjectLineRelationInput{lineID: id})
	}

	for _, item := range activationMapSlice(firstNonNil(body["obligations"], body["obligationRelations"], body["obligation_relations"])) {
		input.addObligationRelation(contractProjectObligationRelationInputFromBody(item))
	}
	for _, code := range uniqueStrings(append(
		activationStringSlice(firstNonNil(body["obligationCodes"], body["obligation_codes"], body["obligation_codes_json"])),
		firstBodyText(body, "obligation_code", "obligationCode"),
	)) {
		input.addObligationRelation(contractProjectObligationRelationInput{obligationCode: code})
	}
	for _, id := range uniqueInt64s(append(
		contractProjectIDSlice(firstNonNil(body["obligationIds"], body["obligation_ids"])),
		altocPositiveID(firstNonNil(body["obligationId"], body["obligation_id"])),
	)) {
		input.addObligationRelation(contractProjectObligationRelationInput{obligationID: id})
	}

	return normalizeContractProjectRelationInput(input)
}

func (input *contractProjectRelationInput) addLineRelation(relation contractProjectLineRelationInput) {
	relation.lineCode = strings.TrimSpace(relation.lineCode)
	if relation.lineID <= 0 && relation.lineCode == "" {
		return
	}
	input.lineRelations = append(input.lineRelations, relation)
	if relation.lineCode != "" {
		input.lineCodes = append(input.lineCodes, relation.lineCode)
	}
	if relation.lineID > 0 {
		input.lineIDs = append(input.lineIDs, relation.lineID)
	}
}

func (input *contractProjectRelationInput) addObligationRelation(relation contractProjectObligationRelationInput) {
	relation.obligationCode = strings.TrimSpace(relation.obligationCode)
	if relation.obligationID <= 0 && relation.obligationCode == "" {
		return
	}
	input.obligationRelations = append(input.obligationRelations, relation)
	if relation.obligationCode != "" {
		input.obligationCodes = append(input.obligationCodes, relation.obligationCode)
	}
	if relation.obligationID > 0 {
		input.obligationIDs = append(input.obligationIDs, relation.obligationID)
	}
}

func contractProjectLineRelationInputFromBody(body map[string]any) contractProjectLineRelationInput {
	return contractProjectLineRelationInput{
		lineCode:         firstBodyText(body, "lineCode", "line_code", "contractLineCode", "contract_line_code", "code"),
		lineID:           altocPositiveID(firstNonNil(body["lineId"], body["line_id"], body["contractLineId"], body["contract_line_id"], body["id"])),
		relationType:     firstBodyText(body, "relationType", "relation_type"),
		allocationMethod: firstBodyText(body, "allocationMethod", "allocation_method"),
		allocationRatio:  contractProjectOptionalDecimal(body, "allocation_ratio", "allocationRatio"),
		allocatedAmount:  contractProjectOptionalDecimal(body, "allocated_amount", "allocatedAmount"),
		plannedWorkdays:  contractProjectOptionalDecimal(body, "planned_workdays", "plannedWorkdays"),
	}
}

func contractProjectObligationRelationInputFromBody(body map[string]any) contractProjectObligationRelationInput {
	return contractProjectObligationRelationInput{
		obligationCode: firstBodyText(body, "obligationCode", "obligation_code", "code"),
		obligationID:   altocPositiveID(firstNonNil(body["obligationId"], body["obligation_id"], body["id"])),
	}
}

func contractProjectIDSlice(value any) []int64 {
	raw := activationStringSlice(value)
	result := make([]int64, 0, len(raw))
	for _, item := range raw {
		if id := altocPositiveID(item); id > 0 {
			result = append(result, id)
		}
	}
	return result
}

func contractProjectRelationType(projectRole string) string {
	switch strings.TrimSpace(projectRole) {
	case "development", "customization":
		return "customization"
	case "training":
		return "training"
	case "warranty":
		return "warranty"
	case "maintenance", "operation":
		return "maintenance"
	case "change":
		return "change"
	case "primary", "delivery", "implementation":
		return "delivery"
	default:
		return "other"
	}
}

func normalizeContractProjectRelationInput(input contractProjectRelationInput) contractProjectRelationInput {
	normalized := contractProjectRelationInput{explicit: input.explicit}
	seenLineRelations := map[string]bool{}
	seenLineRefs := map[string]bool{}
	for _, relation := range input.lineRelations {
		addNormalizedLineRelation(&normalized, relation, seenLineRelations, seenLineRefs)
	}
	for _, code := range input.lineCodes {
		relation := contractProjectLineRelationInput{lineCode: code}
		if ref := contractProjectLineRelationRefKey(relation); ref != "" && !seenLineRefs[ref] {
			addNormalizedLineRelation(&normalized, relation, seenLineRelations, seenLineRefs)
		}
	}
	for _, id := range input.lineIDs {
		relation := contractProjectLineRelationInput{lineID: id}
		if ref := contractProjectLineRelationRefKey(relation); ref != "" && !seenLineRefs[ref] {
			addNormalizedLineRelation(&normalized, relation, seenLineRelations, seenLineRefs)
		}
	}

	seenObligationRefs := map[string]bool{}
	for _, relation := range input.obligationRelations {
		addNormalizedObligationRelation(&normalized, relation, seenObligationRefs)
	}
	for _, code := range input.obligationCodes {
		relation := contractProjectObligationRelationInput{obligationCode: code}
		if ref := contractProjectObligationRelationRefKey(relation); ref != "" && !seenObligationRefs[ref] {
			addNormalizedObligationRelation(&normalized, relation, seenObligationRefs)
		}
	}
	for _, id := range input.obligationIDs {
		relation := contractProjectObligationRelationInput{obligationID: id}
		if ref := contractProjectObligationRelationRefKey(relation); ref != "" && !seenObligationRefs[ref] {
			addNormalizedObligationRelation(&normalized, relation, seenObligationRefs)
		}
	}

	normalized.lineCodes = uniqueStrings(normalized.lineCodes)
	normalized.lineIDs = uniqueInt64s(normalized.lineIDs)
	normalized.obligationCodes = uniqueStrings(normalized.obligationCodes)
	normalized.obligationIDs = uniqueInt64s(normalized.obligationIDs)
	normalized.explicit = normalized.explicit || len(normalized.lineRelations) > 0 || len(normalized.obligationRelations) > 0
	return normalized
}

func addNormalizedLineRelation(input *contractProjectRelationInput, relation contractProjectLineRelationInput, seenRelations map[string]bool, seenRefs map[string]bool) {
	relation.lineCode = strings.TrimSpace(relation.lineCode)
	relation.relationType = strings.TrimSpace(relation.relationType)
	relation.allocationMethod = strings.TrimSpace(relation.allocationMethod)
	ref := contractProjectLineRelationRefKey(relation)
	if ref == "" {
		return
	}
	if relation.relationType == "" && seenRefs[ref] {
		return
	}
	key := ref + ":" + relation.relationType
	if seenRelations[key] {
		return
	}
	seenRelations[key] = true
	for _, alias := range contractProjectLineRelationRefAliases(relation) {
		seenRefs[alias] = true
	}
	input.addLineRelation(relation)
}

func addNormalizedObligationRelation(input *contractProjectRelationInput, relation contractProjectObligationRelationInput, seenRefs map[string]bool) {
	relation.obligationCode = strings.TrimSpace(relation.obligationCode)
	ref := contractProjectObligationRelationRefKey(relation)
	if ref == "" || seenRefs[ref] {
		return
	}
	for _, alias := range contractProjectObligationRelationRefAliases(relation) {
		seenRefs[alias] = true
	}
	input.addObligationRelation(relation)
}

func contractProjectLineRelationRefKey(relation contractProjectLineRelationInput) string {
	if relation.lineID > 0 {
		return fmt.Sprintf("id:%d", relation.lineID)
	}
	if code := strings.TrimSpace(relation.lineCode); code != "" {
		return "code:" + code
	}
	return ""
}

func contractProjectLineRelationRefAliases(relation contractProjectLineRelationInput) []string {
	aliases := []string{}
	if relation.lineID > 0 {
		aliases = append(aliases, fmt.Sprintf("id:%d", relation.lineID))
	}
	if code := strings.TrimSpace(relation.lineCode); code != "" {
		aliases = append(aliases, "code:"+code)
	}
	return aliases
}

func contractProjectObligationRelationRefKey(relation contractProjectObligationRelationInput) string {
	if relation.obligationID > 0 {
		return fmt.Sprintf("id:%d", relation.obligationID)
	}
	if code := strings.TrimSpace(relation.obligationCode); code != "" {
		return "code:" + code
	}
	return ""
}

func contractProjectObligationRelationRefAliases(relation contractProjectObligationRelationInput) []string {
	aliases := []string{}
	if relation.obligationID > 0 {
		aliases = append(aliases, fmt.Sprintf("id:%d", relation.obligationID))
	}
	if code := strings.TrimSpace(relation.obligationCode); code != "" {
		aliases = append(aliases, "code:"+code)
	}
	return aliases
}

func contractProjectAllocationMethod(value string) (string, error) {
	value = strings.TrimSpace(value)
	switch value {
	case "":
		return "unallocated", nil
	case "unallocated", "direct", "ratio", "amount", "workdays":
		return value, nil
	default:
		return "", httperror.New(http.StatusBadRequest, "invalid_contract_project_allocation", "unknown allocation_method: "+value)
	}
}

func contractProjectRelationTypeValue(value string, fallback string) string {
	switch strings.TrimSpace(value) {
	case "delivery", "customization", "training", "warranty", "maintenance", "change", "other":
		return strings.TrimSpace(value)
	default:
		return firstNonEmptyText(strings.TrimSpace(fallback), "other")
	}
}

func validateContractProjectLineAllocation(relations []resolvedContractProjectLineRelation) error {
	totalRatio := 0.0
	ratioCount := 0
	for _, relation := range relations {
		if err := validateContractProjectOptionalAllocationDecimal("allocation_ratio", relation.allocationRatio); err != nil {
			return err
		}
		if err := validateContractProjectOptionalAllocationDecimal("allocated_amount", relation.allocatedAmount); err != nil {
			return err
		}
		if err := validateContractProjectOptionalAllocationDecimal("planned_workdays", relation.plannedWorkdays); err != nil {
			return err
		}
		switch relation.allocationMethod {
		case "unallocated", "direct":
			continue
		case "ratio":
			ratio, ok := contractProjectDecimalValue(relation.allocationRatio)
			if !ok || ratio <= 0 {
				return httperror.New(http.StatusBadRequest, "invalid_contract_project_allocation", "ratio allocation requires allocation_ratio greater than 0")
			}
			totalRatio += ratio
			ratioCount++
		case "amount":
			amount, ok := contractProjectDecimalValue(relation.allocatedAmount)
			if !ok || amount < 0 {
				return httperror.New(http.StatusBadRequest, "invalid_contract_project_allocation", "amount allocation requires allocated_amount greater than or equal to 0")
			}
		case "workdays":
			workdays, ok := contractProjectDecimalValue(relation.plannedWorkdays)
			if !ok || workdays < 0 {
				return httperror.New(http.StatusBadRequest, "invalid_contract_project_allocation", "workdays allocation requires planned_workdays greater than or equal to 0")
			}
		default:
			return httperror.New(http.StatusBadRequest, "invalid_contract_project_allocation", "unknown allocation_method: "+relation.allocationMethod)
		}
	}
	if ratioCount > 0 && math.Abs(totalRatio-100) > 0.0001 {
		return httperror.New(http.StatusBadRequest, "invalid_contract_project_allocation", "ratio allocation across project lines must total 100")
	}
	return nil
}

func validateContractProjectOptionalAllocationDecimal(field string, value any) error {
	if value == nil {
		return nil
	}
	decimal, ok := contractProjectDecimalValue(value)
	if !ok {
		return httperror.New(http.StatusBadRequest, "invalid_contract_project_allocation", field+" must be a valid decimal")
	}
	if decimal < 0 {
		return httperror.New(http.StatusBadRequest, "invalid_contract_project_allocation", field+" must be greater than or equal to 0")
	}
	return nil
}

func contractProjectDecimalValue(value any) (float64, bool) {
	if value == nil {
		return 0, false
	}
	switch typed := value.(type) {
	case int:
		return contractProjectFiniteDecimal(float64(typed))
	case int64:
		return contractProjectFiniteDecimal(float64(typed))
	case float64:
		return contractProjectFiniteDecimal(typed)
	case []byte:
		parsed, err := strconv.ParseFloat(strings.ReplaceAll(strings.TrimSpace(string(typed)), ",", ""), 64)
		if err != nil {
			return 0, false
		}
		return contractProjectFiniteDecimal(parsed)
	case string:
		parsed, err := strconv.ParseFloat(strings.ReplaceAll(strings.TrimSpace(typed), ",", ""), 64)
		if err != nil {
			return 0, false
		}
		return contractProjectFiniteDecimal(parsed)
	default:
		parsed, err := strconv.ParseFloat(strings.ReplaceAll(strings.TrimSpace(fmt.Sprint(value)), ",", ""), 64)
		if err != nil {
			return 0, false
		}
		return contractProjectFiniteDecimal(parsed)
	}
}

func contractProjectFiniteDecimal(value float64) (float64, bool) {
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return 0, false
	}
	return value, true
}

func invalidContractProjectRefsError(kind string, missingCodes []string, missingIDs []string, mismatchRefs []string) error {
	parts := []string{}
	if len(missingCodes) > 0 {
		parts = append(parts, "unmatched "+kind+" codes: "+strings.Join(uniqueStrings(missingCodes), ", "))
	}
	if len(missingIDs) > 0 {
		parts = append(parts, "invalid "+kind+" ids: "+strings.Join(uniqueStrings(missingIDs), ", "))
	}
	if len(mismatchRefs) > 0 {
		parts = append(parts, "mismatched "+kind+" id/code refs: "+strings.Join(uniqueStrings(mismatchRefs), ", "))
	}
	if len(parts) == 0 {
		parts = append(parts, "invalid "+kind+" references")
	}
	return httperror.New(http.StatusBadRequest, "invalid_contract_project_"+kind+"_refs", strings.Join(parts, "; "))
}

func contractProjectOptionalDecimal(body map[string]any, keys ...string) any {
	for _, key := range keys {
		value := firstBodyText(body, key)
		if value != "" {
			return value
		}
	}
	return nil
}

func contractProjectSingleID(values []int64) int64 {
	values = uniqueInt64s(values)
	if len(values) == 1 {
		return values[0]
	}
	return 0
}

func nullablePositiveInt64(value int64) any {
	if value <= 0 {
		return nil
	}
	return value
}

func uniqueInt64s(values []int64) []int64 {
	seen := map[int64]bool{}
	result := make([]int64, 0, len(values))
	for _, value := range values {
		if value <= 0 || seen[value] {
			continue
		}
		seen[value] = true
		result = append(result, value)
	}
	return result
}

func lockContractByIDTx(ctx context.Context, tx *sql.Tx, contractID int64) (map[string]any, error) {
	return altocQueryOneMap(ctx, tx, `
		SELECT *
		FROM contract
		WHERE id = ?
		  AND deleted_at IS NULL
		LIMIT 1
		FOR UPDATE
	`, contractID)
}

func lockContractProjectLinkTx(ctx context.Context, tx *sql.Tx, contractID int64, linkID int64) (map[string]any, error) {
	return altocQueryOneMap(ctx, tx, `
		SELECT *
		FROM contract_project_link
		WHERE id = ?
		  AND contract_id = ?
		  AND deleted_at IS NULL
		LIMIT 1
		FOR UPDATE
	`, linkID, contractID)
}

func contractProjectLinkByKeyTx(ctx context.Context, tx *sql.Tx, contractID int64, projectCode string, projectRole string) (map[string]any, error) {
	return altocQueryOneMap(ctx, tx, `
		SELECT *
		FROM contract_project_link
		WHERE contract_id = ?
		  AND project_code = ?
		  AND project_role = ?
		  AND deleted_at IS NULL
		LIMIT 1
		FOR UPDATE
	`, contractID, projectCode, projectRole)
}
