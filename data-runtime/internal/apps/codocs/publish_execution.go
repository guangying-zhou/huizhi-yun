package codocs

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

var (
	publishArchiveInvalidTitleChars = regexp.MustCompile(`[\\/:*?"<>|]`)
	publishArchiveWhitespace        = regexp.MustCompile(`\s+`)
	publishArchiveSeparators        = regexp.MustCompile(`_+`)
	publishSealTypes                = map[string]bool{
		"official": true,
		"legal":    true,
		"finance":  true,
		"contract": true,
	}
	publishSendChannels = map[string]bool{
		"email":         true,
		"wecom":         true,
		"wechat_qq":     true,
		"web_upload":    true,
		"sf_express":    true,
		"other_courier": true,
		"other_method":  true,
		"usb":           true,
	}
)

type publishExecutionRow struct {
	ID                    int64
	DocumentID            int64
	DocumentUUID          string
	ReviewType            string
	SubType               sql.NullString
	InitiatorUID          string
	TargetCategory        string
	Extra                 sql.NullString
	ReviewOSSPath         sql.NullString
	WorkflowStatus        string
	ArchiveOSSPath        sql.NullString
	ExecutionStatus       sql.NullString
	PublishedDocumentUUID sql.NullString
	DocumentTitle         string
	DocumentType          string
	DocumentOSSPath       string
	DocumentContentSize   int64
	DocumentDeptCode      sql.NullString
	DocumentStatus        int64
}

type publishArchivePlan struct {
	ArchiveKey              string
	ArchiveLabel            string
	ArchiveOSSPath          string
	PublishedDocumentUUID   string
	PublishedDocumentType   string
	InitialExecutionStatus  string
	NeedsOfficialSeal       bool
	PublishScope            string
	SourceOSSPath           string
	SourceDocumentType      string
	ReviewSnapshotOSSPath   string
	SourceDepartmentCode    string
	SourceDocumentTitle     string
	SourceDocumentUUID      string
	SourceDocumentID        int64
	SourceDocumentSize      int64
	PublishRequestInitiator string
}

func (a *Adapter) loadPublishExecutionRowForUpdate(ctx context.Context, tx *sql.Tx, requestID int64) (publishExecutionRow, error) {
	var row publishExecutionRow
	err := tx.QueryRowContext(ctx, `
		SELECT pr.id,pr.document_id,pr.document_uuid,pr.review_type,pr.sub_type,pr.initiator_uid,
		       pr.target_category,pr.extra,pr.review_oss_path,pr.workflow_status,pr.archive_oss_path,
		       pr.execution_status,pr.published_document_uuid,
		       d.title,d.doc_type,d.oss_path,COALESCE(d.content_size,0),d.dept_code,d.status
		  FROM document_publish_requests pr
		  INNER JOIN documents d ON d.id=pr.document_id AND d.uuid=pr.document_uuid
		 WHERE pr.id=?
		 FOR UPDATE`, requestID).Scan(
		&row.ID,
		&row.DocumentID,
		&row.DocumentUUID,
		&row.ReviewType,
		&row.SubType,
		&row.InitiatorUID,
		&row.TargetCategory,
		&row.Extra,
		&row.ReviewOSSPath,
		&row.WorkflowStatus,
		&row.ArchiveOSSPath,
		&row.ExecutionStatus,
		&row.PublishedDocumentUUID,
		&row.DocumentTitle,
		&row.DocumentType,
		&row.DocumentOSSPath,
		&row.DocumentContentSize,
		&row.DocumentDeptCode,
		&row.DocumentStatus,
	)
	if err == sql.ErrNoRows {
		return row, httperror.New(http.StatusNotFound, "publish_request_not_found", "Workflow publish request not found")
	}
	return row, err
}

func requirePublishExecutionActor(query url.Values) (string, error) {
	return requireTrustedReviewActor(query)
}

func parsePublishExecutionRequestID(raw string) (int64, error) {
	return parsePublishWorkflowRequestID(raw)
}

func stablePublishedDocumentUUID(requestID int64, sourceDocumentUUID string) string {
	digest := sha256.Sum256([]byte(fmt.Sprintf("codocs:publish-request:%d:archive:%s:v1", requestID, sourceDocumentUUID)))
	bytes := digest[:16]
	bytes[6] = (bytes[6] & 0x0f) | 0x40
	bytes[8] = (bytes[8] & 0x3f) | 0x80
	encoded := hex.EncodeToString(bytes)
	return encoded[0:8] + "-" + encoded[8:12] + "-" + encoded[12:16] + "-" + encoded[16:20] + "-" + encoded[20:32]
}

func sanitizePublishArchiveTitle(title string) string {
	title = publishArchiveInvalidTitleChars.ReplaceAllString(strings.TrimSpace(title), "_")
	title = publishArchiveWhitespace.ReplaceAllString(title, "_")
	title = publishArchiveSeparators.ReplaceAllString(title, "_")
	title = strings.Trim(title, "._ ")
	runes := []rune(title)
	if len(runes) > 100 {
		title = string(runes[:100])
	}
	if title == "" {
		return "untitled"
	}
	return title
}

func publishArchiveDirectory(row publishExecutionRow) (archiveKey string, directory string, label string, scope string, err error) {
	archiveKey = strings.TrimSpace(row.SubType.String)
	if archiveKey == "" {
		archiveKey = strings.TrimSpace(row.ReviewType)
	}
	deptCode := strings.TrimSpace(row.DocumentDeptCode.String)
	switch archiveKey {
	case "会议记录", "投票表决":
		if deptCode == "" {
			return "", "", "", "", httperror.New(http.StatusConflict, "publish_department_required", "Department publish target is missing")
		}
		return archiveKey, "codocs/departments/" + deptCode + "/records", "部门文档/会议记录", "department", nil
	case "部门规章":
		if deptCode == "" {
			return "", "", "", "", httperror.New(http.StatusConflict, "publish_department_required", "Department publish target is missing")
		}
		return archiveKey, "codocs/departments/" + deptCode + "/rules", "部门文档/部门规章", "department", nil
	case "对外发文":
		if deptCode == "" {
			return "", "", "", "", httperror.New(http.StatusConflict, "publish_department_required", "Department publish target is missing")
		}
		return archiveKey, "codocs/departments/" + deptCode + "/outsides", "部门文档/对外发文", "department", nil
	}

	companyTargets := map[string]struct {
		dir   string
		label string
	}{
		"公司制度":  {dir: "rules", label: "组织资产/公司制度"},
		"通知公告":  {dir: "notices", label: "组织资产/通知公告"},
		"法务合规":  {dir: "legal", label: "组织资产/法务合规"},
		"产品资料":  {dir: "products", label: "组织资产/产品资料"},
		"知识库":   {dir: "knowledge", label: "组织资产/知识库"},
		"公司知识库": {dir: "knowledge", label: "组织资产/公司知识库"},
		"企业文化":  {dir: "culture", label: "组织资产/企业文化"},
		"技术规范":  {dir: "tech-specs", label: "组织资产/技术规范"},
		"文档模板":  {dir: "templates", label: "组织资产/文档模板"},
	}
	target, ok := companyTargets[archiveKey]
	if !ok {
		return "", "", "", "", httperror.New(http.StatusConflict, "publish_archive_target_invalid", "Publish archive target is not supported")
	}
	return archiveKey, "codocs/company/" + target.dir, target.label, "company", nil
}

func publishedDocumentType(targetCategory string) string {
	switch targetCategory {
	case "department":
		return "department"
	case "product":
		return "product"
	case "knowledge":
		return "knowledge"
	default:
		return "company"
	}
}

func buildPublishArchivePlan(row publishExecutionRow) (publishArchivePlan, error) {
	archiveKey, directory, label, scope, err := publishArchiveDirectory(row)
	if err != nil {
		return publishArchivePlan{}, err
	}
	extra, _ := jsonObjectValue(row.Extra.String).(map[string]any)
	needsOfficialSeal := boolValue(extra["needsOfficialSeal"])
	executionStatus := ""
	if row.ReviewType == "对外发文" {
		if needsOfficialSeal {
			executionStatus = "pending_seal"
		} else {
			executionStatus = "pending_send"
		}
	}
	sourceOSSPath := strings.TrimSpace(row.ReviewOSSPath.String)
	if sourceOSSPath == "" {
		sourceOSSPath = strings.TrimSpace(row.DocumentOSSPath)
	}
	if sourceOSSPath == "" {
		return publishArchivePlan{}, httperror.New(http.StatusConflict, "publish_source_missing", "Publish source content is missing")
	}
	publishedUUID := stablePublishedDocumentUUID(row.ID, row.DocumentUUID)
	return publishArchivePlan{
		ArchiveKey:              archiveKey,
		ArchiveLabel:            label,
		ArchiveOSSPath:          fmt.Sprintf("%s/%s_%d.md", directory, sanitizePublishArchiveTitle(row.DocumentTitle), row.ID),
		PublishedDocumentUUID:   publishedUUID,
		PublishedDocumentType:   publishedDocumentType(row.TargetCategory),
		InitialExecutionStatus:  executionStatus,
		NeedsOfficialSeal:       needsOfficialSeal,
		PublishScope:            scope,
		SourceOSSPath:           sourceOSSPath,
		SourceDocumentType:      row.DocumentType,
		ReviewSnapshotOSSPath:   strings.TrimSpace(row.ReviewOSSPath.String),
		SourceDepartmentCode:    strings.TrimSpace(row.DocumentDeptCode.String),
		SourceDocumentTitle:     row.DocumentTitle,
		SourceDocumentUUID:      row.DocumentUUID,
		SourceDocumentID:        row.DocumentID,
		SourceDocumentSize:      row.DocumentContentSize,
		PublishRequestInitiator: row.InitiatorUID,
	}, nil
}

func publishArchivePlanResponse(row publishExecutionRow, plan publishArchivePlan, alreadyArchived bool) map[string]any {
	return map[string]any{
		"publishRequestId":          row.ID,
		"alreadyArchived":           alreadyArchived,
		"sourceOssPath":             plan.SourceOSSPath,
		"sourceDocumentType":        plan.SourceDocumentType,
		"reviewSnapshotOssPath":     nullableString(plan.ReviewSnapshotOSSPath),
		"archiveOssPath":            plan.ArchiveOSSPath,
		"publishedDocumentUuid":     plan.PublishedDocumentUUID,
		"publishedDocumentType":     plan.PublishedDocumentType,
		"documentTitle":             plan.SourceDocumentTitle,
		"reviewType":                row.ReviewType,
		"archiveKey":                plan.ArchiveKey,
		"archiveLabel":              plan.ArchiveLabel,
		"publishScope":              plan.PublishScope,
		"departmentCode":            nullableString(plan.SourceDepartmentCode),
		"initiatorUid":              row.InitiatorUID,
		"needsOfficialSeal":         plan.NeedsOfficialSeal,
		"initialExecutionStatus":    nullableString(plan.InitialExecutionStatus),
		"currentExecutionStatus":    nullableString(row.ExecutionStatus.String),
		"sourceDocumentUuid":        row.DocumentUUID,
		"sourceDocumentContentSize": row.DocumentContentSize,
	}
}

func validatePublishArchiveState(row publishExecutionRow, actorUID string) error {
	if row.InitiatorUID != actorUID {
		return httperror.New(http.StatusForbidden, "publish_initiator_required", "Only the Workflow publish request initiator may confirm publication")
	}
	if row.DocumentStatus == 0 {
		return httperror.New(http.StatusConflict, "publish_source_unavailable", "Publish source document is unavailable")
	}
	if row.WorkflowStatus != "approved" {
		return httperror.New(http.StatusConflict, "publish_workflow_not_approved", "Only a Workflow-approved publish request may be archived")
	}
	return nil
}

func (a *Adapter) preparePublishArchive(ctx context.Context, rawID string, query url.Values) (map[string]any, error) {
	actorUID, err := requirePublishExecutionActor(query)
	if err != nil {
		return nil, err
	}
	requestID, err := parsePublishExecutionRequestID(rawID)
	if err != nil {
		return nil, err
	}
	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	row, err := a.loadPublishExecutionRowForUpdate(ctx, tx, requestID)
	if err != nil {
		return nil, err
	}
	if err := validatePublishArchiveState(row, actorUID); err != nil {
		return nil, err
	}
	plan, err := buildPublishArchivePlan(row)
	if err != nil {
		return nil, err
	}
	if row.ArchiveOSSPath.Valid || row.PublishedDocumentUUID.Valid {
		if row.ArchiveOSSPath.String == plan.ArchiveOSSPath && row.PublishedDocumentUUID.String == plan.PublishedDocumentUUID {
			if err := tx.Commit(); err != nil {
				return nil, err
			}
			return publishArchivePlanResponse(row, plan, true), nil
		}
		return nil, httperror.New(http.StatusConflict, "publish_archive_binding_conflict", "Publish request is already bound to a different archive")
	}
	var existingUUID string
	err = tx.QueryRowContext(ctx, "SELECT uuid FROM documents WHERE oss_path=? AND status<>0 LIMIT 1", plan.ArchiveOSSPath).Scan(&existingUUID)
	if err != nil && err != sql.ErrNoRows {
		return nil, err
	}
	if existingUUID != "" {
		return nil, httperror.New(http.StatusConflict, "publish_archive_path_conflict", "A published document already uses the target archive path")
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return publishArchivePlanResponse(row, plan, false), nil
}

func publishInfoJSON(plan publishArchivePlan, reviewType string) (string, error) {
	value, err := json.Marshal(map[string]any{
		"label":       plan.ArchiveLabel,
		"date":        time.Now().UTC().Format(time.RFC3339),
		"archiveUuid": plan.PublishedDocumentUUID,
		"reviewType":  reviewType,
	})
	return string(value), err
}

func (a *Adapter) commitPublishArchive(ctx context.Context, rawID string, query url.Values, body map[string]any) (map[string]any, error) {
	actorUID, err := requirePublishExecutionActor(query)
	if err != nil {
		return nil, err
	}
	requestID, err := parsePublishExecutionRequestID(rawID)
	if err != nil {
		return nil, err
	}
	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	row, err := a.loadPublishExecutionRowForUpdate(ctx, tx, requestID)
	if err != nil {
		return nil, err
	}
	if err := validatePublishArchiveState(row, actorUID); err != nil {
		return nil, err
	}
	plan, err := buildPublishArchivePlan(row)
	if err != nil {
		return nil, err
	}
	if row.ArchiveOSSPath.Valid || row.PublishedDocumentUUID.Valid {
		if row.ArchiveOSSPath.String != plan.ArchiveOSSPath || row.PublishedDocumentUUID.String != plan.PublishedDocumentUUID {
			return nil, httperror.New(http.StatusConflict, "publish_archive_binding_conflict", "Publish request is already bound to a different archive")
		}
		if err := tx.Commit(); err != nil {
			return nil, err
		}
		result := publishArchivePlanResponse(row, plan, true)
		result["executionStatus"] = nullableString(row.ExecutionStatus.String)
		result["idempotent"] = true
		return result, nil
	}
	if strings.TrimSpace(stringValue(body["archiveOssPath"])) != plan.ArchiveOSSPath ||
		strings.TrimSpace(stringValue(body["publishedDocumentUuid"])) != plan.PublishedDocumentUUID {
		return nil, httperror.New(http.StatusConflict, "publish_archive_plan_mismatch", "Archive completion does not match the trusted publish plan")
	}
	var existingID int64
	err = tx.QueryRowContext(ctx, "SELECT id FROM documents WHERE (uuid=? OR oss_path=?) AND status<>0 LIMIT 1", plan.PublishedDocumentUUID, plan.ArchiveOSSPath).Scan(&existingID)
	if err != nil && err != sql.ErrNoRows {
		return nil, err
	}
	if existingID > 0 {
		return nil, httperror.New(http.StatusConflict, "publish_archive_document_conflict", "Published document identity or archive path already exists")
	}
	result, err := tx.ExecContext(ctx, `
		INSERT INTO documents
		  (uuid,title,doc_type,oss_path,owner_uid,dept_code,status,content_size,last_editor_uid,readonly_flag,created_at,updated_at)
		VALUES (?,?,?,?,?,?,2,?,?,1,NOW(),NOW())`,
		plan.PublishedDocumentUUID,
		plan.SourceDocumentTitle,
		plan.PublishedDocumentType,
		plan.ArchiveOSSPath,
		row.InitiatorUID,
		nullableString(plan.SourceDepartmentCode),
		plan.SourceDocumentSize,
		row.InitiatorUID,
	)
	if err != nil {
		return nil, err
	}
	publishedDocumentID, _ := result.LastInsertId()
	if err := upsertDocumentRelationTx(ctx, tx, documentRelationInput{
		DocumentID:   publishedDocumentID,
		DocumentUUID: plan.PublishedDocumentUUID,
		RelatedUID:   row.InitiatorUID,
		RelationType: "created_by_me",
		SourceType:   "document",
		SourceID:     fmt.Sprint(publishedDocumentID),
		CanRead:      true,
		CanEdit:      true,
		Metadata: map[string]any{
			"docType":  plan.PublishedDocumentType,
			"deptCode": nullableString(plan.SourceDepartmentCode),
		},
	}); err != nil {
		return nil, err
	}
	if row.ReviewType == "对外发文" {
		if err := upsertDocumentRelationTx(ctx, tx, documentRelationInput{
			DocumentID:   publishedDocumentID,
			DocumentUUID: plan.PublishedDocumentUUID,
			RelatedUID:   row.InitiatorUID,
			RelationType: "outside_initiator",
			SourceType:   "publish_request",
			SourceID:     fmt.Sprint(row.ID),
			CanRead:      true,
			Metadata: map[string]any{
				"publishRequestId": row.ID,
				"sourceDeptCode":   nullableString(plan.SourceDepartmentCode),
			},
		}); err != nil {
			return nil, err
		}
	}
	publishInfo, err := publishInfoJSON(plan, row.ReviewType)
	if err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, "UPDATE documents SET publish_info=?,readonly_flag=1,updated_at=NOW() WHERE id=? AND uuid=?", publishInfo, row.DocumentID, row.DocumentUUID); err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE document_publish_requests
		   SET archive_oss_path=?,execution_status=?,published_document_uuid=?,updated_at=NOW()
		 WHERE id=? AND workflow_status='approved' AND archive_oss_path IS NULL AND published_document_uuid IS NULL`,
		plan.ArchiveOSSPath,
		nullableString(plan.InitialExecutionStatus),
		plan.PublishedDocumentUUID,
		row.ID,
	); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	response := publishArchivePlanResponse(row, plan, false)
	response["executionStatus"] = nullableString(plan.InitialExecutionStatus)
	response["publishedDocumentId"] = publishedDocumentID
	response["idempotent"] = false
	return response, nil
}

func validateArchivedOutsidePublish(row publishExecutionRow) error {
	if row.ReviewType != "对外发文" {
		return httperror.New(http.StatusConflict, "outside_publish_required", "Only external publication supports this execution action")
	}
	if row.WorkflowStatus != "approved" || !row.ArchiveOSSPath.Valid || !row.PublishedDocumentUUID.Valid {
		return httperror.New(http.StatusConflict, "published_document_required", "Only an archived Workflow publication supports this execution action")
	}
	return nil
}

func normalizeSealTypes(value any) ([]string, error) {
	raw, ok := value.([]any)
	if !ok {
		if typed, typedOK := value.([]string); typedOK {
			raw = make([]any, len(typed))
			for index, item := range typed {
				raw[index] = item
			}
		}
	}
	values := make([]string, 0, len(raw))
	seen := map[string]bool{}
	for _, item := range raw {
		value := strings.TrimSpace(stringValue(item))
		if value == "" || seen[value] {
			continue
		}
		if !publishSealTypes[value] {
			return nil, httperror.New(http.StatusBadRequest, "seal_type_invalid", "Seal type is invalid")
		}
		seen[value] = true
		values = append(values, value)
	}
	if len(values) == 0 {
		return nil, httperror.New(http.StatusBadRequest, "seal_type_required", "At least one seal type is required")
	}
	sort.Strings(values)
	return values, nil
}

func sameStringList(left []string, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}

func positiveIntegerInput(value any) (int64, bool) {
	switch typed := value.(type) {
	case float64:
		if typed < 1 || typed != math.Trunc(typed) {
			return 0, false
		}
		return int64(typed), true
	case float32:
		if typed < 1 || typed != float32(math.Trunc(float64(typed))) {
			return 0, false
		}
		return int64(typed), true
	default:
		parsed := int64Value(value)
		return parsed, parsed > 0
	}
}

func (a *Adapter) existingSealRecord(ctx context.Context, tx *sql.Tx, row publishExecutionRow) (int64, []string, int64, string, string, error) {
	var id, pageCount int64
	var sealTypes any
	var operatorUID string
	var remark sql.NullString
	err := tx.QueryRowContext(ctx, `
		SELECT id,seal_types,page_count,operator_uid,remark
		  FROM document_seal_records
		 WHERE review_id=? AND document_uuid=?
		 ORDER BY confirmed_at DESC,id DESC
		 LIMIT 1
		 FOR UPDATE`, row.ID, row.PublishedDocumentUUID.String).Scan(&id, &sealTypes, &pageCount, &operatorUID, &remark)
	if err == sql.ErrNoRows {
		return 0, nil, 0, "", "", nil
	}
	if err != nil {
		return 0, nil, 0, "", "", err
	}
	values := stringListJSONValue(sealTypes)
	sort.Strings(values)
	return id, values, pageCount, operatorUID, remark.String, nil
}

func (a *Adapter) confirmPublishSeal(ctx context.Context, rawID string, query url.Values, body map[string]any) (map[string]any, error) {
	actorUID, err := requirePublishExecutionActor(query)
	if err != nil {
		return nil, err
	}
	requestID, err := parsePublishExecutionRequestID(rawID)
	if err != nil {
		return nil, err
	}
	sealTypes, err := normalizeSealTypes(body["sealTypes"])
	if err != nil {
		return nil, err
	}
	pageCount, validPageCount := positiveIntegerInput(body["pageCount"])
	if !validPageCount {
		return nil, httperror.New(http.StatusBadRequest, "seal_page_count_invalid", "Seal page count must be a positive integer")
	}
	remark := strings.TrimSpace(stringValue(body["remark"]))
	if len([]rune(remark)) > 500 {
		return nil, httperror.New(http.StatusBadRequest, "seal_remark_too_long", "Seal remark is too long")
	}
	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	row, err := a.loadPublishExecutionRowForUpdate(ctx, tx, requestID)
	if err != nil {
		return nil, err
	}
	if err := validateArchivedOutsidePublish(row); err != nil {
		return nil, err
	}
	extra, _ := jsonObjectValue(row.Extra.String).(map[string]any)
	if !boolValue(extra["needsOfficialSeal"]) {
		return nil, httperror.New(http.StatusConflict, "official_seal_not_required", "This publication does not require an official seal")
	}
	if row.ExecutionStatus.String != "pending_seal" {
		recordID, existingTypes, existingPages, existingOperator, existingRemark, lookupErr := a.existingSealRecord(ctx, tx, row)
		if lookupErr != nil {
			return nil, lookupErr
		}
		if recordID > 0 && sameStringList(sealTypes, existingTypes) && pageCount == existingPages && actorUID == existingOperator && remark == existingRemark {
			if err := tx.Commit(); err != nil {
				return nil, err
			}
			return map[string]any{
				"id": recordID, "executionStatus": row.ExecutionStatus.String, "idempotent": true,
				"initiatorUid": row.InitiatorUID, "documentTitle": row.DocumentTitle,
			}, nil
		}
		return nil, httperror.New(http.StatusConflict, "publish_execution_state_conflict", "Publication is not awaiting seal confirmation")
	}
	sealJSON, err := json.Marshal(sealTypes)
	if err != nil {
		return nil, err
	}
	result, err := tx.ExecContext(ctx, `
		INSERT INTO document_seal_records
		  (review_id,document_uuid,seal_types,page_count,operator_uid,remark,confirmed_at,created_at,updated_at)
		VALUES (?,?,?,?,?,?,NOW(),NOW(),NOW())`,
		row.ID,
		row.PublishedDocumentUUID.String,
		string(sealJSON),
		pageCount,
		actorUID,
		nullableString(remark),
	)
	if err != nil {
		return nil, err
	}
	recordID, _ := result.LastInsertId()
	if _, err := tx.ExecContext(ctx, `
		UPDATE document_publish_requests
		   SET execution_status='pending_send',sealed_at=NOW(),updated_at=NOW()
		 WHERE id=? AND execution_status='pending_seal'`, row.ID); err != nil {
		return nil, err
	}
	publishedDocumentID, err := a.publishedDocumentIDForUpdate(ctx, tx, row)
	if err != nil {
		return nil, err
	}
	if err := upsertDocumentRelationTx(ctx, tx, documentRelationInput{
		DocumentID:   publishedDocumentID,
		DocumentUUID: row.PublishedDocumentUUID.String,
		RelatedUID:   actorUID,
		RelationType: "outside_seal_handler",
		SourceType:   "publish_request",
		SourceID:     fmt.Sprint(row.ID),
		CanRead:      true,
		Metadata:     map[string]any{"publishRequestId": row.ID},
	}); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{
		"id": recordID, "executionStatus": "pending_send", "idempotent": false,
		"initiatorUid": row.InitiatorUID, "documentTitle": row.DocumentTitle,
	}, nil
}

func validDateInput(value string) (time.Time, error) {
	value = strings.TrimSpace(value)
	date, err := time.Parse("2006-01-02", value)
	if err != nil {
		return time.Time{}, httperror.New(http.StatusBadRequest, "date_invalid", "Date must use YYYY-MM-DD")
	}
	today, _ := time.Parse("2006-01-02", time.Now().Format("2006-01-02"))
	if date.After(today) {
		return time.Time{}, httperror.New(http.StatusBadRequest, "date_in_future", "Date cannot be later than today")
	}
	return date, nil
}

func requiredText(body map[string]any, key string, max int, code string) (string, error) {
	value := strings.TrimSpace(stringValue(body[key]))
	if value == "" {
		return "", httperror.New(http.StatusBadRequest, code+"_required", key+" is required")
	}
	if len([]rune(value)) > max {
		return "", httperror.New(http.StatusBadRequest, code+"_too_long", key+" is too long")
	}
	return value, nil
}

func (a *Adapter) publishedDocumentIDForUpdate(ctx context.Context, tx *sql.Tx, row publishExecutionRow) (int64, error) {
	var id int64
	err := tx.QueryRowContext(ctx, "SELECT id FROM documents WHERE uuid=? AND oss_path=? AND status=2 LIMIT 1 FOR UPDATE", row.PublishedDocumentUUID.String, row.ArchiveOSSPath.String).Scan(&id)
	if err == sql.ErrNoRows {
		return 0, httperror.New(http.StatusConflict, "published_document_missing", "Published document metadata is missing")
	}
	return id, err
}

func databaseDateString(value any) string {
	if value == nil {
		return ""
	}
	switch typed := value.(type) {
	case time.Time:
		return typed.Format("2006-01-02")
	case []byte:
		return string(typed)
	default:
		text := strings.TrimSpace(fmt.Sprint(value))
		if len(text) >= 10 {
			return text[:10]
		}
		return text
	}
}

func (a *Adapter) existingSendRecord(ctx context.Context, tx *sql.Tx, row publishExecutionRow) (map[string]any, error) {
	var id int64
	var senderUID, receiverName, receiverPhone, channel string
	var sentDate, receiveDate any
	var targetAccount, remark sql.NullString
	err := tx.QueryRowContext(ctx, `
		SELECT id,sender_uid,receiver_name,receiver_phone,channel,sent_date,receive_date,target_account,remark
		  FROM document_send_records
		 WHERE review_id=? AND document_uuid=?
		 ORDER BY confirmed_at DESC,id DESC
		 LIMIT 1
		 FOR UPDATE`, row.ID, row.PublishedDocumentUUID.String).Scan(
		&id, &senderUID, &receiverName, &receiverPhone, &channel, &sentDate, &receiveDate, &targetAccount, &remark,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"id": id, "senderUid": senderUID, "receiverName": receiverName, "receiverPhone": receiverPhone,
		"channel": channel, "sentDate": databaseDateString(sentDate), "receiveDate": databaseDateString(receiveDate),
		"targetAccount": targetAccount.String, "remark": remark.String,
	}, nil
}

func sameSendInput(existing map[string]any, senderUID string, receiverName string, receiverPhone string, channel string, sentDate string, targetAccount string, remark string) bool {
	return existing != nil &&
		stringValue(existing["senderUid"]) == senderUID &&
		stringValue(existing["receiverName"]) == receiverName &&
		stringValue(existing["receiverPhone"]) == receiverPhone &&
		stringValue(existing["channel"]) == channel &&
		stringValue(existing["sentDate"]) == sentDate &&
		stringValue(existing["targetAccount"]) == targetAccount &&
		stringValue(existing["remark"]) == remark
}

func (a *Adapter) confirmPublishSend(ctx context.Context, rawID string, query url.Values, body map[string]any) (map[string]any, error) {
	actorUID, err := requirePublishExecutionActor(query)
	if err != nil {
		return nil, err
	}
	requestID, err := parsePublishExecutionRequestID(rawID)
	if err != nil {
		return nil, err
	}
	senderUID, err := requiredText(body, "senderUid", 64, "sender_uid")
	if err != nil {
		return nil, err
	}
	receiverName, err := requiredText(body, "receiverName", 100, "receiver_name")
	if err != nil {
		return nil, err
	}
	receiverPhone, err := requiredText(body, "receiverPhone", 30, "receiver_phone")
	if err != nil {
		return nil, err
	}
	channel := strings.TrimSpace(stringValue(body["channel"]))
	if !publishSendChannels[channel] {
		return nil, httperror.New(http.StatusBadRequest, "send_channel_invalid", "Send channel is invalid")
	}
	sentDate := strings.TrimSpace(stringValue(body["sentDate"]))
	if _, err := validDateInput(sentDate); err != nil {
		return nil, err
	}
	targetAccount := strings.TrimSpace(stringValue(body["targetAccount"]))
	remark := strings.TrimSpace(stringValue(body["remark"]))
	if len([]rune(targetAccount)) > 200 || len([]rune(remark)) > 500 {
		return nil, httperror.New(http.StatusBadRequest, "send_details_too_long", "Send details are too long")
	}
	if channel != "usb" && channel != "other_method" && targetAccount == "" {
		return nil, httperror.New(http.StatusBadRequest, "target_account_required", "Target account or delivery information is required")
	}
	if channel == "other_method" && remark == "" {
		return nil, httperror.New(http.StatusBadRequest, "send_remark_required", "Other send method requires a remark")
	}
	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	row, err := a.loadPublishExecutionRowForUpdate(ctx, tx, requestID)
	if err != nil {
		return nil, err
	}
	if err := validateArchivedOutsidePublish(row); err != nil {
		return nil, err
	}
	if actorUID != row.InitiatorUID {
		return nil, httperror.New(http.StatusForbidden, "publish_initiator_required", "Only the publication initiator may confirm sending")
	}
	if row.ExecutionStatus.String != "pending_send" {
		existing, lookupErr := a.existingSendRecord(ctx, tx, row)
		if lookupErr != nil {
			return nil, lookupErr
		}
		if sameSendInput(existing, senderUID, receiverName, receiverPhone, channel, sentDate, targetAccount, remark) {
			if err := tx.Commit(); err != nil {
				return nil, err
			}
			return map[string]any{
				"id": existing["id"], "executionStatus": row.ExecutionStatus.String, "idempotent": true,
				"initiatorUid": row.InitiatorUID, "documentTitle": row.DocumentTitle, "senderUid": senderUID,
			}, nil
		}
		return nil, httperror.New(http.StatusConflict, "publish_execution_state_conflict", "Publication is not awaiting send confirmation")
	}
	result, err := tx.ExecContext(ctx, `
		INSERT INTO document_send_records
		  (review_id,document_uuid,sender_uid,receiver_name,receiver_phone,channel,sent_date,target_account,remark,confirmed_at,created_at,updated_at)
		VALUES (?,?,?,?,?,?,?,?,?,NOW(),NOW(),NOW())`,
		row.ID,
		row.PublishedDocumentUUID.String,
		senderUID,
		receiverName,
		receiverPhone,
		channel,
		sentDate,
		nullableString(targetAccount),
		nullableString(remark),
	)
	if err != nil {
		return nil, err
	}
	recordID, _ := result.LastInsertId()
	if _, err := tx.ExecContext(ctx, `
		UPDATE document_publish_requests
		   SET execution_status='pending_receive',sent_at=NOW(),updated_at=NOW()
		 WHERE id=? AND execution_status='pending_send'`, row.ID); err != nil {
		return nil, err
	}
	publishedDocumentID, err := a.publishedDocumentIDForUpdate(ctx, tx, row)
	if err != nil {
		return nil, err
	}
	if err := upsertDocumentRelationTx(ctx, tx, documentRelationInput{
		DocumentID:   publishedDocumentID,
		DocumentUUID: row.PublishedDocumentUUID.String,
		RelatedUID:   senderUID,
		RelationType: "outside_sender",
		SourceType:   "publish_request",
		SourceID:     fmt.Sprint(row.ID),
		CanRead:      true,
		Metadata: map[string]any{
			"publishRequestId": row.ID,
			"sourceDeptCode":   nullableString(row.DocumentDeptCode.String),
		},
	}); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{
		"id": recordID, "executionStatus": "pending_receive", "idempotent": false,
		"initiatorUid": row.InitiatorUID, "documentTitle": row.DocumentTitle, "senderUid": senderUID,
	}, nil
}

func (a *Adapter) confirmPublishReceive(ctx context.Context, rawID string, query url.Values, body map[string]any) (map[string]any, error) {
	actorUID, err := requirePublishExecutionActor(query)
	if err != nil {
		return nil, err
	}
	requestID, err := parsePublishExecutionRequestID(rawID)
	if err != nil {
		return nil, err
	}
	receiveDate := strings.TrimSpace(stringValue(body["receiveDate"]))
	parsedReceiveDate, err := validDateInput(receiveDate)
	if err != nil {
		return nil, err
	}
	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	row, err := a.loadPublishExecutionRowForUpdate(ctx, tx, requestID)
	if err != nil {
		return nil, err
	}
	if err := validateArchivedOutsidePublish(row); err != nil {
		return nil, err
	}
	existing, err := a.existingSendRecord(ctx, tx, row)
	if err != nil {
		return nil, err
	}
	if existing == nil {
		return nil, httperror.New(http.StatusConflict, "send_record_required", "Send record is required before receive confirmation")
	}
	if actorUID != stringValue(existing["senderUid"]) {
		return nil, httperror.New(http.StatusForbidden, "send_actor_required", "Only the designated sender may confirm receipt")
	}
	if row.ExecutionStatus.String == "received" {
		if stringValue(existing["receiveDate"]) == receiveDate {
			if err := tx.Commit(); err != nil {
				return nil, err
			}
			return map[string]any{
				"executionStatus": "received", "idempotent": true,
				"initiatorUid": row.InitiatorUID, "documentTitle": row.DocumentTitle,
			}, nil
		}
		return nil, httperror.New(http.StatusConflict, "receive_already_confirmed", "Receipt was already confirmed with different data")
	}
	if row.ExecutionStatus.String != "pending_receive" {
		return nil, httperror.New(http.StatusConflict, "publish_execution_state_conflict", "Publication is not awaiting receive confirmation")
	}
	sentDate, parseErr := time.Parse("2006-01-02", stringValue(existing["sentDate"]))
	if parseErr != nil {
		return nil, httperror.New(http.StatusConflict, "send_date_invalid", "Stored send date is invalid")
	}
	if parsedReceiveDate.Before(sentDate) {
		return nil, httperror.New(http.StatusBadRequest, "receive_before_send", "Receive date cannot be earlier than send date")
	}
	if stringValue(existing["receiveDate"]) != "" {
		return nil, httperror.New(http.StatusConflict, "receive_already_confirmed", "Send record was already confirmed as received")
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE document_send_records
		   SET receive_date=?,received_confirmed_at=NOW(),updated_at=NOW()
		 WHERE id=? AND receive_date IS NULL`, receiveDate, existing["id"]); err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE document_publish_requests
		   SET execution_status='received',received_at=NOW(),updated_at=NOW()
		 WHERE id=? AND execution_status='pending_receive'`, row.ID); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{
		"executionStatus": "received", "idempotent": false,
		"initiatorUid": row.InitiatorUID, "documentTitle": row.DocumentTitle,
	}, nil
}
