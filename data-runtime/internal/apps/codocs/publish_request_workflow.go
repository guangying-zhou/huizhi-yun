package codocs

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

const (
	codocsPublishWorkflowOperationCode = "codocs.publish-request.workflow-submit.v1"
	codocsPublishWorkflowCapability    = "workflow:document-publish:create"
	codocsPublishWorkflowSchema        = "v1"
)

type publishWorkflowRow struct {
	ID                 int64
	DocumentID         int64
	DocumentUUID       string
	ReviewType         string
	SubType            sql.NullString
	InitiatorUID       string
	TargetCategory     string
	Extra              sql.NullString
	WorkflowInstanceID sql.NullInt64
	WorkflowInstanceNo sql.NullString
	WorkflowStatus     string
	DocumentTitle      string
	DocumentStatus     int64
	DocumentDeptCode   sql.NullString
}

func parsePublishWorkflowRequestID(raw string) (int64, error) {
	id, err := strconv.ParseInt(strings.TrimSpace(raw), 10, 64)
	if err != nil || id <= 0 {
		return 0, httperror.New(http.StatusBadRequest, "invalid_publish_request", "Publish request id is invalid")
	}
	return id, nil
}

func (a *Adapter) loadPublishWorkflowRowForUpdate(ctx context.Context, tx *sql.Tx, requestID int64) (publishWorkflowRow, error) {
	var row publishWorkflowRow
	err := tx.QueryRowContext(ctx, `
		SELECT pr.id,pr.document_id,pr.document_uuid,pr.review_type,pr.sub_type,pr.initiator_uid,
		       pr.target_category,pr.extra,pr.workflow_instance_id,pr.workflow_instance_no,pr.workflow_status,
		       d.title,d.status,d.dept_code
		  FROM document_publish_requests pr
		  INNER JOIN documents d ON d.id=pr.document_id AND d.uuid=pr.document_uuid
		 WHERE pr.id=?
		 FOR UPDATE`, requestID).Scan(
		&row.ID, &row.DocumentID, &row.DocumentUUID, &row.ReviewType, &row.SubType, &row.InitiatorUID,
		&row.TargetCategory, &row.Extra, &row.WorkflowInstanceID, &row.WorkflowInstanceNo, &row.WorkflowStatus,
		&row.DocumentTitle, &row.DocumentStatus, &row.DocumentDeptCode,
	)
	if err == sql.ErrNoRows {
		return row, httperror.New(http.StatusNotFound, "publish_request_not_found", "Publish request not found")
	}
	return row, err
}

// A request id is the source-side stable business key. Deriving a UUIDv4-shaped
// operation id from it makes an interrupted BFF call recover the same target
// receipt without persisting a second, parallel command identity in Codocs.
func stablePublishWorkflowOperationID(requestID int64) string {
	digest := sha256.Sum256([]byte(fmt.Sprintf("codocs:publish-request:%d:workflow-submit:v1", requestID)))
	bytes := digest[:16]
	bytes[6] = (bytes[6] & 0x0f) | 0x40
	bytes[8] = (bytes[8] & 0x3f) | 0x80
	encoded := hex.EncodeToString(bytes)
	return encoded[0:8] + "-" + encoded[8:12] + "-" + encoded[12:16] + "-" + encoded[16:20] + "-" + encoded[20:32]
}

func publishWorkflowCommand(row publishWorkflowRow) (map[string]any, string, error) {
	key := fmt.Sprintf("codocs:publish-request:%d:workflow-submit:v1", row.ID)
	extra := jsonObjectValue(row.Extra.String)
	extraMap, _ := extra.(map[string]any)
	bizContext := map[string]any{
		"document_uuid": row.DocumentUUID, "review_type": row.ReviewType,
		"sub_type": row.SubType.String, "target_category": row.TargetCategory,
		"resource_dept_code":  row.DocumentDeptCode.String,
		"outside_file_level":  stringValue(extraMap["outsideFileLevel"]),
		"needs_official_seal": boolValue(extraMap["needsOfficialSeal"]),
		"business_dept_code":  stringValue(extraMap["businessDeptCode"]),
		"committee_dept_code": stringValue(extraMap["committeeDeptCode"]),
		"upper_leader_id":     stringValue(extraMap["upperLeaderId"]),
		"extra":               extra,
	}
	formData := map[string]any{
		"review_type": row.ReviewType, "sub_type": row.SubType.String,
		"target_category":      row.TargetCategory,
		"send_to":              stringValue(extraMap["sendTo"]),
		"send_reason":          stringValue(extraMap["sendReason"]),
		"outside_file_level":   stringValue(extraMap["outsideFileLevel"]),
		"needs_official_seal":  boolValue(extraMap["needsOfficialSeal"]),
		"business_dept_code":   stringValue(extraMap["businessDeptCode"]),
		"committee_dept_code":  stringValue(extraMap["committeeDeptCode"]),
		"committee_mode":       stringValue(extraMap["committeeMode"]),
		"committee_pass_count": int64Value(extraMap["committeePassCount"]),
		"committee_vote_type":  stringValue(extraMap["committeeVoteType"]),
		"extra":                extra,
	}
	command := map[string]any{
		"publishRequestId": row.ID,
		"documentUUID":     row.DocumentUUID,
		"actorUid":         row.InitiatorUID,
		"idempotencyKey":   key,
		"bizTitle":         row.DocumentTitle,
		"bizContext":       bizContext,
		"formData":         formData,
	}
	sha, err := integrationoperation.ValidateAndDigestCommand(command)
	if err != nil {
		return nil, "", err
	}
	return command, sha, nil
}

func publishWorkflowEnvelope(row publishWorkflowRow) (map[string]any, error) {
	command, sha, err := publishWorkflowCommand(row)
	if err != nil {
		return nil, err
	}
	key := fmt.Sprintf("codocs:publish-request:%d:workflow-submit:v1", row.ID)
	return map[string]any{
		"operationId": stablePublishWorkflowOperationID(row.ID), "targetApp": "workflow",
		"operationCode": codocsPublishWorkflowOperationCode, "requiredCapability": codocsPublishWorkflowCapability,
		"idempotencyKey": key, "commandSchemaVersion": codocsPublishWorkflowSchema,
		"commandSha256": sha, "command": command,
	}, nil
}

func (a *Adapter) preparePublishRequestWorkflowCommand(ctx context.Context, rawID string, query url.Values) (map[string]any, error) {
	actorUID, err := requireTrustedReviewActor(query)
	if err != nil {
		return nil, err
	}
	requestID, err := parsePublishWorkflowRequestID(rawID)
	if err != nil {
		return nil, err
	}
	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()
	row, err := a.loadPublishWorkflowRowForUpdate(ctx, tx, requestID)
	if err != nil {
		return nil, err
	}
	if actorUID != row.InitiatorUID {
		return nil, httperror.New(http.StatusForbidden, "publish_request_initiator_required", "Only the publish request initiator may bind Workflow")
	}
	if row.DocumentStatus == 0 || row.DocumentUUID == "" || row.DocumentTitle == "" {
		return nil, httperror.New(http.StatusConflict, "publish_request_document_unavailable", "Publish request document is unavailable")
	}
	if row.WorkflowInstanceNo.Valid && row.WorkflowInstanceNo.String != "" {
		return map[string]any{"bound": true, "workflowInstanceId": row.WorkflowInstanceID.Int64, "workflowInstanceNo": row.WorkflowInstanceNo.String, "workflowStatus": row.WorkflowStatus}, tx.Commit()
	}
	if row.WorkflowStatus != "draft" {
		return nil, httperror.New(http.StatusConflict, "publish_request_not_bindable", "Publish request is not awaiting Workflow binding")
	}
	envelope, err := publishWorkflowEnvelope(row)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"bound": false, "serviceCommand": envelope}, nil
}

func (a *Adapter) checkpointPublishRequestWorkflow(ctx context.Context, rawID string, query url.Values, body map[string]any) (map[string]any, error) {
	actorUID, err := requireTrustedReviewActor(query)
	if err != nil {
		return nil, err
	}
	requestID, err := parsePublishWorkflowRequestID(rawID)
	if err != nil {
		return nil, err
	}
	instanceID := int64Value(body["workflowInstanceId"])
	instanceNo := strings.TrimSpace(fmt.Sprint(body["workflowInstanceNo"]))
	if instanceID <= 0 || instanceNo == "" {
		return nil, httperror.New(http.StatusBadRequest, "workflow_receipt_invalid", "Workflow receipt instance identity is required")
	}
	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()
	row, err := a.loadPublishWorkflowRowForUpdate(ctx, tx, requestID)
	if err != nil {
		return nil, err
	}
	if actorUID != row.InitiatorUID {
		return nil, httperror.New(http.StatusForbidden, "publish_request_initiator_required", "Only the publish request initiator may checkpoint Workflow")
	}
	envelope, err := publishWorkflowEnvelope(row)
	if err != nil {
		return nil, err
	}
	for key, expected := range map[string]string{
		"operationId": fmt.Sprint(envelope["operationId"]), "operationCode": codocsPublishWorkflowOperationCode,
		"idempotencyKey": fmt.Sprint(envelope["idempotencyKey"]), "commandSchemaVersion": codocsPublishWorkflowSchema,
		"commandSha256": fmt.Sprint(envelope["commandSha256"]), "targetBizType": "workflow_instance", "targetBizCode": instanceNo,
	} {
		if strings.TrimSpace(fmt.Sprint(body[key])) != expected {
			return nil, httperror.New(http.StatusConflict, "workflow_receipt_mismatch", "Workflow receipt does not match the locked publish request")
		}
	}
	if row.WorkflowInstanceNo.Valid && row.WorkflowInstanceNo.String != "" {
		if row.WorkflowInstanceNo.String != instanceNo || !row.WorkflowInstanceID.Valid || row.WorkflowInstanceID.Int64 != instanceID {
			return nil, httperror.New(http.StatusConflict, "publish_request_workflow_binding_conflict", "Publish request is already bound to a different Workflow instance")
		}
		if err := tx.Commit(); err != nil {
			return nil, err
		}
		return map[string]any{"workflowInstanceId": instanceID, "workflowInstanceNo": instanceNo, "idempotent": true}, nil
	}
	if row.WorkflowStatus != "draft" {
		return nil, httperror.New(http.StatusConflict, "publish_request_not_bindable", "Publish request is not awaiting Workflow binding")
	}
	if _, err := tx.ExecContext(ctx, `UPDATE document_publish_requests SET workflow_instance_id=?,workflow_instance_no=?,workflow_status='running',updated_at=NOW() WHERE id=?`, instanceID, instanceNo, row.ID); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"workflowInstanceId": instanceID, "workflowInstanceNo": instanceNo, "idempotent": false}, nil
}

// The Codocs BFF validates Workflow's short-lived service token before calling
// this minimal target-state command. Runtime deliberately accepts only the
// instance number and terminal status; business payload fields never cross the
// callback boundary.
func (a *Adapter) applyPublishRequestWorkflowCallback(ctx context.Context, rawID string, body map[string]any) (map[string]any, error) {
	requestID, err := parsePublishWorkflowRequestID(rawID)
	if err != nil {
		return nil, err
	}
	instanceNo := strings.TrimSpace(fmt.Sprint(body["instanceNo"]))
	status := strings.TrimSpace(fmt.Sprint(body["status"]))
	if instanceNo == "" || (status != "approved" && status != "rejected" && status != "cancelled") {
		return nil, httperror.New(http.StatusBadRequest, "workflow_callback_invalid", "Workflow callback instance and terminal status are required")
	}
	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()
	row, err := a.loadPublishWorkflowRowForUpdate(ctx, tx, requestID)
	if err != nil {
		return nil, err
	}
	if !row.WorkflowInstanceNo.Valid || row.WorkflowInstanceNo.String != instanceNo {
		return nil, httperror.New(http.StatusConflict, "workflow_callback_binding_mismatch", "Workflow callback does not match the publish request binding")
	}
	if row.WorkflowStatus == status {
		if err := tx.Commit(); err != nil {
			return nil, err
		}
		return map[string]any{"workflowInstanceNo": instanceNo, "workflowStatus": status, "idempotent": true}, nil
	}
	if row.WorkflowStatus != "running" {
		return nil, httperror.New(http.StatusConflict, "workflow_callback_state_conflict", "Publish request is not running")
	}
	if _, err := tx.ExecContext(ctx, `UPDATE document_publish_requests SET workflow_status=?,updated_at=NOW() WHERE id=? AND workflow_instance_no=? AND workflow_status='running'`, status, row.ID, instanceNo); err != nil {
		return nil, err
	}
	if status == "rejected" || status == "cancelled" {
		if _, err := tx.ExecContext(ctx, `UPDATE documents SET readonly_flag=0,updated_at=NOW() WHERE id=? AND uuid=?`, row.DocumentID, row.DocumentUUID); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"workflowInstanceNo": instanceNo, "workflowStatus": status, "idempotent": false}, nil
}
