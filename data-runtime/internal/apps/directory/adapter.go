package directory

import (
	"context"
	"crypto"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/config"
	"github.com/huizhi-yun/data-runtime/internal/db"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

const (
	headerConnectorID      = "X-HZY-Directory-Connector-ID"
	headerTimestamp        = "X-HZY-Directory-Timestamp"
	headerNonce            = "X-HZY-Directory-Nonce"
	headerBodySHA256       = "X-HZY-Directory-Body-SHA256"
	headerSignature        = "X-HZY-Directory-Signature"
	headerRuntimeID        = "X-HZY-Connector-Runtime-ID"
	headerRuntimeTimestamp = "X-HZY-Connector-Timestamp"
	headerRuntimeNonce     = "X-HZY-Connector-Nonce"
	headerRuntimeBodySHA   = "X-HZY-Connector-Body-SHA256"
	headerRuntimeSignature = "X-HZY-Connector-Signature"
)

type Adapter struct {
	db             *sql.DB
	ownsDB         bool
	tenant         string
	platformURL    string
	runtimeToken   string
	projectionHTTP *http.Client
	nonces         sync.Map
}

func (a *Adapter) AuthenticateConnectorRuntimeRequest(ctx context.Context, r *http.Request, rawBody []byte) (ConnectorIdentity, error) {
	connectorID := strings.TrimSpace(r.Header.Get(headerRuntimeID))
	timestampText := strings.TrimSpace(r.Header.Get(headerRuntimeTimestamp))
	nonce := strings.TrimSpace(r.Header.Get(headerRuntimeNonce))
	bodySHA := strings.ToLower(strings.TrimSpace(r.Header.Get(headerRuntimeBodySHA)))
	signatureText := strings.TrimSpace(r.Header.Get(headerRuntimeSignature))
	if connectorID == "" || timestampText == "" || nonce == "" || bodySHA == "" || signatureText == "" {
		return ConnectorIdentity{}, httperror.New(http.StatusUnauthorized, "connector_runtime_signature_missing", "Connector Runtime request signature is required")
	}
	timestamp, err := strconv.ParseInt(timestampText, 10, 64)
	if err != nil || time.Since(time.Unix(timestamp, 0)) > 90*time.Second || time.Until(time.Unix(timestamp, 0)) > 30*time.Second {
		return ConnectorIdentity{}, httperror.New(http.StatusUnauthorized, "connector_runtime_signature_expired", "Connector Runtime request timestamp is invalid or expired")
	}
	if len(nonce) < 16 || len(nonce) > 128 {
		return ConnectorIdentity{}, httperror.New(http.StatusUnauthorized, "connector_runtime_nonce_invalid", "Connector Runtime request nonce is invalid")
	}
	actual := sha256.Sum256(rawBody)
	if hex.EncodeToString(actual[:]) != bodySHA {
		return ConnectorIdentity{}, httperror.New(http.StatusUnauthorized, "connector_runtime_body_mismatch", "Connector Runtime request body digest does not match")
	}
	var row connectorRow
	err = a.db.QueryRowContext(ctx, `SELECT connector_id,tenant_code,deployment_code,public_key_pem FROM connector_runtime_instances WHERE connector_id=? AND status='active' LIMIT 1`, connectorID).Scan(&row.ConnectorID, &row.TenantCode, &row.DeploymentCode, &row.PublicKeyPEM)
	if errors.Is(err, sql.ErrNoRows) {
		return ConnectorIdentity{}, httperror.New(http.StatusForbidden, "connector_runtime_not_registered", "Connector Runtime is not registered")
	}
	if err != nil {
		return ConnectorIdentity{}, err
	}
	if a.tenant != "" && row.TenantCode != a.tenant {
		return ConnectorIdentity{}, httperror.New(http.StatusForbidden, "connector_runtime_tenant_mismatch", "Connector Runtime tenant does not match this runtime")
	}
	block, _ := pem.Decode([]byte(row.PublicKeyPEM))
	if block == nil {
		return ConnectorIdentity{}, httperror.New(http.StatusForbidden, "connector_runtime_key_invalid", "Connector Runtime public key is invalid")
	}
	parsedKey, err := x509.ParsePKIXPublicKey(block.Bytes)
	publicKey, ok := parsedKey.(*rsa.PublicKey)
	if err != nil || !ok || publicKey.N.BitLen() < 3072 {
		return ConnectorIdentity{}, httperror.New(http.StatusForbidden, "connector_runtime_key_invalid", "Connector Runtime public key is invalid")
	}
	signature, err := base64.RawURLEncoding.DecodeString(signatureText)
	if err != nil {
		return ConnectorIdentity{}, httperror.New(http.StatusUnauthorized, "connector_runtime_signature_invalid", "Connector Runtime request signature is invalid")
	}
	canonical := canonicalRequest(r.Method, r.URL.EscapedPath(), timestampText, nonce, bodySHA)
	digest := sha256.Sum256([]byte(canonical))
	if err = rsa.VerifyPSS(publicKey, crypto.SHA256, digest[:], signature, nil); err != nil {
		return ConnectorIdentity{}, httperror.New(http.StatusUnauthorized, "connector_runtime_signature_invalid", "Connector Runtime request signature is invalid")
	}
	nonceKey := "runtime:" + connectorID + ":" + nonce
	if _, loaded := a.nonces.LoadOrStore(nonceKey, time.Now()); loaded {
		return ConnectorIdentity{}, httperror.New(http.StatusConflict, "connector_runtime_request_replayed", "Connector Runtime request was already processed")
	}
	a.pruneNonces()
	return ConnectorIdentity{ConnectorID: row.ConnectorID, TenantCode: row.TenantCode, DeploymentCode: row.DeploymentCode}, nil
}

func (a *Adapter) ResolveDingTalkPeopleBatch(ctx context.Context, body map[string]any) ([]map[string]any, []map[string]any, int, error) {
	rawUsers, ok := body["users"].([]any)
	if !ok && body["users"] != nil {
		return nil, nil, 0, httperror.New(http.StatusBadRequest, "connector_people_users_invalid", "People sync users must be an array")
	}
	if len(rawUsers) > 500 {
		return nil, nil, 0, httperror.New(http.StatusRequestEntityTooLarge, "connector_people_batch_too_large", "People sync batch accepts at most 500 users")
	}
	items := make([]map[string]any, 0, len(rawUsers))
	candidates := make([]map[string]any, 0)
	skipped := 0
	for _, raw := range rawUsers {
		user, ok := raw.(map[string]any)
		if !ok {
			skipped++
			continue
		}
		subject := text(user["providerSubject"])
		if subject == "" || len(subject) > 255 || strings.ContainsAny(subject, "\r\n\x00") {
			skipped++
			continue
		}
		var uid, username, displayName, status string
		var existingDept, existingPosition sql.NullString
		err := a.db.QueryRowContext(ctx, `SELECT du.uid,COALESCE(du.username,''),COALESCE(du.display_name,du.uid),du.status,du.primary_dept_code,du.position_title FROM directory_identities di INNER JOIN directory_users du ON du.uid=di.uid WHERE di.provider_code='dingtalk' AND di.provider_subject=? AND di.status<>'deleted' AND du.status<>'deleted' LIMIT 1`, subject).Scan(&uid, &username, &displayName, &status, &existingDept, &existingPosition)
		if errors.Is(err, sql.ErrNoRows) {
			email := strings.ToLower(text(user["email"]))
			if email != "" {
				var emailMatches int
				if countErr := a.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM directory_users WHERE LOWER(TRIM(email))=? AND status<>'deleted'`, email).Scan(&emailMatches); countErr != nil {
					return nil, nil, skipped, countErr
				}
				if emailMatches > 1 {
					// Never create or bind a DingTalk identity from an ambiguous
					// local email address.
					skipped++
					continue
				}
				if emailMatches == 1 {
					err = a.db.QueryRowContext(ctx, `SELECT uid,COALESCE(username,''),COALESCE(display_name,uid),status,primary_dept_code,position_title
						FROM directory_users WHERE LOWER(TRIM(email))=? AND status<>'deleted' LIMIT 1`, email).Scan(&uid, &username, &displayName, &status, &existingDept, &existingPosition)
				}
			}
			if errors.Is(err, sql.ErrNoRows) || email == "" {
				employmentStatus := normalizeDingTalkEmploymentStatus(user)
				if employmentStatus == "left" {
					// Historical departures that were never managed by Huizhi
					// have no Directory account to disable and no stable local
					// employee identity to update.
					skipped++
					continue
				}
				// 未命中既有身份的员工不再合成 dt-* UID。合成主体会立刻写入
				// people_employees 并冻结生命周期，使员工业务主键、登录身份和
				// 授权主体三者分叉，事后只能靠受控归并修复。改为交给 People
				// 落成入职候选单，等 canonical UID 真正可用后再升格为正式员工。
				candidates = append(candidates, dingTalkOnboardingCandidate(user, subject))
				continue
			}
		}
		if err != nil {
			return nil, nil, skipped, err
		}
		name := trimDingTalkText(user["name"], 100)
		if name == "" {
			name = displayName
		}
		title := trimDingTalkText(user["title"], 100)
		if title == "" {
			title = existingPosition.String
		}
		deptCode, deptName := existingDept.String, ""
		departmentID := text(user["primaryDepartmentId"])
		if departmentID == "" {
			if rawIDs, ok := user["departmentIds"].([]any); ok && len(rawIDs) > 0 {
				departmentID = text(rawIDs[0])
			}
		}
		if departmentID != "" {
			var resolvedCode, resolvedName string
			if queryErr := a.db.QueryRowContext(ctx, `SELECT d.dept_code,d.dept_name
				FROM directory_department_identities i
				INNER JOIN directory_departments d ON d.dept_code=i.dept_code
				WHERE i.provider_code='dingtalk' AND i.external_department_id=?
					AND i.status='active' AND d.status<>'deleted' LIMIT 1`, departmentID).Scan(&resolvedCode, &resolvedName); queryErr == nil {
				deptCode, deptName = resolvedCode, resolvedName
			} else if errors.Is(queryErr, sql.ErrNoRows) {
				return nil, nil, skipped, httperror.New(http.StatusConflict, "dingtalk_people_department_unmapped", "DingTalk employee primary department is not mapped to a canonical department")
			} else {
				return nil, nil, skipped, queryErr
			}
		}

		managerUID := ""
		managerSubject := text(user["managerSubject"])
		if managerSubject != "" && managerSubject != subject {
			// 经理同样不得合成 dt-*：那会在 people_employees.manager_uid 上
			// 留下永远指向不存在主体的悬挂引用。经理尚未落地时留空，
			// 只透传外部标识，由 People 关联候选单或进待补办清单。
			if queryErr := a.db.QueryRowContext(ctx, `SELECT uid FROM directory_identities WHERE provider_code='dingtalk' AND provider_subject=? AND status<>'deleted' LIMIT 1`, managerSubject).Scan(&managerUID); errors.Is(queryErr, sql.ErrNoRows) {
				managerUID = ""
			} else if queryErr != nil {
				return nil, nil, skipped, queryErr
			}
		}

		employmentStatus := normalizeDingTalkEmploymentStatus(user)
		onboardDate := trimDingTalkText(user["onboardDate"], 10)
		leaveDate := trimDingTalkText(user["leaveDate"], 10)
		effectiveFrom := onboardDate
		if employmentStatus == "leaving" || employmentStatus == "left" {
			effectiveFrom = leaveDate
		}
		item := map[string]any{
			"employee_uid": uid, "display_name": name,
			"login_name": username, "dept_code": deptCode, "dept_name": deptName,
			"position_name": title, "manager_uid": managerUID,
			"manager_provider_subject": managerSubject,
			"employment_status":        employmentStatus,
			"leave_date":               leaveDate,
			"leave_reason":             trimDingTalkText(user["leaveReason"], 500),
			"effective_from":           effectiveFrom, "source_biz_id": subject,
			"provider_subject": subject,
		}
		// Connector Runtime 保留了 provider 的字段存在性。这里只在源 key
		// 真正存在时复制，不能把 absent 再折叠成显式空字符串。
		copyDingTalkField(item, "email", user, "email", 255)
		copyDingTalkField(item, "mobile", user, "mobile", 64)
		copyDingTalkField(item, "onboard_date", user, "onboardDate", 10)
		copyDingTalkField(item, "id_number", user, "idNumber", 64)
		copyDingTalkField(item, "birth_date", user, "birthDate", 32)
		copyDingTalkField(item, "education_level", user, "educationLevel", 255)
		copyDingTalkField(item, "major", user, "major", 255)
		copyDingTalkField(item, "graduation_school", user, "graduationSchool", 255)
		copyDingTalkField(item, "graduation_date", user, "graduationDate", 32)
		items = append(items, item)
	}
	return items, candidates, skipped, nil
}

func (a *Adapter) ApplyDingTalkDepartmentBatch(ctx context.Context, body map[string]any) (int, error) {
	rawDepartments, ok := body["departments"].([]any)
	if !ok && body["departments"] != nil {
		return 0, httperror.New(http.StatusBadRequest, "connector_people_departments_invalid", "People sync departments must be an array")
	}
	if len(rawDepartments) > 500 {
		return 0, httperror.New(http.StatusRequestEntityTooLarge, "connector_people_batch_too_large", "People sync batch accepts at most 500 departments")
	}
	if len(rawDepartments) == 0 {
		return 0, nil
	}
	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	applied := 0
	snapshotRevision := trimDingTalkText(body["watermark"], 128)
	for _, raw := range rawDepartments {
		department, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		providerID := text(department["providerId"])
		name := trimDingTalkText(department["name"], 255)
		if providerID == "" || len(providerID) > 255 || name == "" {
			continue
		}
		parentProviderID := text(department["parentProviderId"])
		if parentProviderID != "" && parentProviderID == providerID {
			_ = tx.Rollback()
			return 0, httperror.New(http.StatusConflict, "dingtalk_department_parent_invalid", "DingTalk department cannot be its own parent")
		}
		parentCode := ""
		var parentID any
		departmentPath := "/"
		departmentLevel := 1
		if parentProviderID != "" {
			var id int64
			var parentPath string
			var parentLevel int
			if queryErr := tx.QueryRowContext(ctx, `SELECT d.dept_code,d.id,COALESCE(d.dept_path,'/'),d.level_no
				FROM directory_department_identities i
				INNER JOIN directory_departments d ON d.dept_code=i.dept_code
				WHERE i.provider_code='dingtalk' AND i.external_department_id=?
					AND i.status='active' AND d.status<>'deleted' LIMIT 1 FOR UPDATE`, parentProviderID).Scan(&parentCode, &id, &parentPath, &parentLevel); queryErr == nil {
				parentID = id
				departmentPath = strings.TrimRight(parentPath, "/") + "/" + parentCode + "/"
				departmentLevel = parentLevel + 1
			} else if !errors.Is(queryErr, sql.ErrNoRows) {
				_ = tx.Rollback()
				return 0, queryErr
			} else {
				_ = tx.Rollback()
				return 0, httperror.New(http.StatusConflict, "dingtalk_department_parent_unmapped", "DingTalk department parent must be mapped before its child")
			}
		}
		sortOrder := consoleInt(department["sortOrder"], 100)
		if sortOrder < 0 || sortOrder > 2147483647 {
			_ = tx.Rollback()
			return 0, httperror.New(http.StatusBadRequest, "dingtalk_department_sort_order_invalid", "DingTalk department sort order is invalid")
		}
		managerSubject := trimDingTalkText(department["managerSubject"], 255)
		if strings.ContainsAny(managerSubject, "\r\n\x00") {
			_ = tx.Rollback()
			return 0, httperror.New(http.StatusBadRequest, "dingtalk_department_manager_invalid", "DingTalk department manager identity is invalid")
		}
		if _, err := upsertDingTalkCanonicalDepartment(ctx, tx, providerID, name, parentCode, parentID, departmentPath, departmentLevel, parentProviderID, sortOrder, managerSubject, snapshotRevision); err != nil {
			_ = tx.Rollback()
			return 0, err
		}
		applied++
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return applied, nil
}

func normalizeDingTalkEmploymentStatus(user map[string]any) string {
	switch strings.ToLower(strings.TrimSpace(fmt.Sprint(user["employmentStatus"]))) {
	case "leaving":
		return "leaving"
	case "left", "resigned":
		return "left"
	case "inactive":
		return "inactive"
	case "active":
		return "active"
	}
	if active, ok := user["active"].(bool); ok && !active {
		return "inactive"
	}
	return "active"
}

// dingTalkOnboardingCandidate 把一条未命中既有身份的钉钉员工快照整理成入职
// 候选事实。这里刻意不解析部门、岗位和经理 UID：那些是 HR 在入职单上确认的
// canonical 事实，用钉钉原值预填会让人误以为已经确认过。
func dingTalkOnboardingCandidate(user map[string]any, subject string) map[string]any {
	candidate := map[string]any{
		"provider_code":            "dingtalk",
		"provider_subject":         subject,
		"candidate_name":           trimDingTalkText(user["name"], 100),
		"position_name":            trimDingTalkText(user["title"], 100),
		"manager_provider_subject": trimDingTalkText(user["managerSubject"], 255),
	}
	copyDingTalkField(candidate, "email", user, "email", 255)
	copyDingTalkField(candidate, "mobile", user, "mobile", 64)
	copyDingTalkField(candidate, "source_onboard_date", user, "onboardDate", 10)
	return candidate
}

func copyDingTalkField(target map[string]any, targetKey string, source map[string]any, sourceKey string, limit int) {
	value, present := source[sourceKey]
	if !present {
		return
	}
	target[targetKey] = trimDingTalkText(value, limit)
}

func dingTalkDepartmentRef(providerID string) string {
	return "dingtalk:department:" + strings.TrimSpace(providerID)
}

func trimDingTalkText(value any, limit int) string {
	text := strings.TrimSpace(fmt.Sprint(value))
	if value == nil {
		return ""
	}
	runes := []rune(text)
	if len(runes) > limit {
		return string(runes[:limit])
	}
	return text
}

type ConnectorIdentity struct {
	ConnectorID    string
	TenantCode     string
	DeploymentCode string
}

type connectorRow struct {
	ConnectorID    string
	TenantCode     string
	DeploymentCode string
	PublicKeyPEM   string
}

func New(cfg config.DirectoryConfig, tenant, platformURL, runtimeToken string) (*Adapter, error) {
	conn, err := db.Open(cfg.DB)
	if err != nil {
		return nil, err
	}
	return newAdapter(conn, true, tenant, platformURL, runtimeToken), nil
}

// NewWithDB shares the hzy_console connection pool owned by the Console
// adapter. Directory does not close a shared pool.
func NewWithDB(conn *sql.DB, tenant, platformURL, runtimeToken string) *Adapter {
	return newAdapter(conn, false, tenant, platformURL, runtimeToken)
}

func newAdapter(conn *sql.DB, ownsDB bool, tenant, platformURL, runtimeToken string) *Adapter {
	return &Adapter{
		db:             conn,
		ownsDB:         ownsDB,
		tenant:         strings.TrimSpace(tenant),
		platformURL:    strings.TrimRight(strings.TrimSpace(platformURL), "/"),
		runtimeToken:   strings.TrimSpace(runtimeToken),
		projectionHTTP: &http.Client{Timeout: 60 * time.Second},
	}
}

func (a *Adapter) Ping(ctx context.Context) error {
	return a.db.PingContext(ctx)
}

func (a *Adapter) Close() error {
	if !a.ownsDB {
		return nil
	}
	return a.db.Close()
}

func canonicalRequest(method, path, timestamp, nonce, bodySHA string) string {
	return strings.Join([]string{strings.ToUpper(method), path, timestamp, nonce, bodySHA}, "\n")
}

func (a *Adapter) AuthenticateRequest(ctx context.Context, r *http.Request, body map[string]any) (ConnectorIdentity, error) {
	connectorID := strings.TrimSpace(r.Header.Get(headerConnectorID))
	timestampText := strings.TrimSpace(r.Header.Get(headerTimestamp))
	nonce := strings.TrimSpace(r.Header.Get(headerNonce))
	bodySHA := strings.ToLower(strings.TrimSpace(r.Header.Get(headerBodySHA256)))
	signatureText := strings.TrimSpace(r.Header.Get(headerSignature))
	if connectorID == "" || timestampText == "" || nonce == "" || bodySHA == "" || signatureText == "" {
		return ConnectorIdentity{}, httperror.New(http.StatusUnauthorized, "directory_connector_signature_missing", "Directory Connector request signature is required")
	}
	timestamp, err := strconv.ParseInt(timestampText, 10, 64)
	if err != nil || time.Since(time.Unix(timestamp, 0)) > 90*time.Second || time.Until(time.Unix(timestamp, 0)) > 30*time.Second {
		return ConnectorIdentity{}, httperror.New(http.StatusUnauthorized, "directory_connector_signature_expired", "Directory Connector request timestamp is invalid or expired")
	}
	if len(nonce) < 16 || len(nonce) > 128 {
		return ConnectorIdentity{}, httperror.New(http.StatusUnauthorized, "directory_connector_nonce_invalid", "Directory Connector request nonce is invalid")
	}
	encodedBody, err := json.Marshal(body)
	if err != nil {
		return ConnectorIdentity{}, httperror.New(http.StatusBadRequest, "directory_connector_body_invalid", "Directory Connector request body is invalid")
	}
	actualBodyHash := sha256.Sum256(encodedBody)
	if hex.EncodeToString(actualBodyHash[:]) != bodySHA {
		return ConnectorIdentity{}, httperror.New(http.StatusUnauthorized, "directory_connector_body_mismatch", "Directory Connector request body digest does not match")
	}

	var row connectorRow
	err = a.db.QueryRowContext(ctx, `SELECT connector_id,tenant_code,deployment_code,public_key_pem
		FROM directory_connectors WHERE connector_id=? AND status='active' LIMIT 1`, connectorID).
		Scan(&row.ConnectorID, &row.TenantCode, &row.DeploymentCode, &row.PublicKeyPEM)
	if errors.Is(err, sql.ErrNoRows) {
		return ConnectorIdentity{}, httperror.New(http.StatusForbidden, "directory_connector_not_registered", "Directory Connector is not registered")
	}
	if err != nil {
		return ConnectorIdentity{}, err
	}
	if a.tenant != "" && row.TenantCode != a.tenant {
		return ConnectorIdentity{}, httperror.New(http.StatusForbidden, "directory_connector_tenant_mismatch", "Directory Connector tenant does not match this runtime")
	}
	block, _ := pem.Decode([]byte(row.PublicKeyPEM))
	if block == nil {
		return ConnectorIdentity{}, httperror.New(http.StatusForbidden, "directory_connector_key_invalid", "Directory Connector public key is invalid")
	}
	parsedKey, err := x509.ParsePKIXPublicKey(block.Bytes)
	publicKey, ok := parsedKey.(*rsa.PublicKey)
	if err != nil || !ok || publicKey.N.BitLen() < 3072 {
		return ConnectorIdentity{}, httperror.New(http.StatusForbidden, "directory_connector_key_invalid", "Directory Connector public key is invalid")
	}
	signature, err := base64.RawURLEncoding.DecodeString(signatureText)
	if err != nil {
		return ConnectorIdentity{}, httperror.New(http.StatusUnauthorized, "directory_connector_signature_invalid", "Directory Connector request signature is invalid")
	}
	canonical := canonicalRequest(r.Method, r.URL.EscapedPath(), timestampText, nonce, bodySHA)
	digest := sha256.Sum256([]byte(canonical))
	if err := rsa.VerifyPSS(publicKey, crypto.SHA256, digest[:], signature, nil); err != nil {
		return ConnectorIdentity{}, httperror.New(http.StatusUnauthorized, "directory_connector_signature_invalid", "Directory Connector request signature is invalid")
	}
	nonceKey := connectorID + ":" + nonce
	if _, loaded := a.nonces.LoadOrStore(nonceKey, time.Now()); loaded {
		return ConnectorIdentity{}, httperror.New(http.StatusConflict, "directory_connector_request_replayed", "Directory Connector request was already processed")
	}
	a.pruneNonces()
	return ConnectorIdentity{ConnectorID: row.ConnectorID, TenantCode: row.TenantCode, DeploymentCode: row.DeploymentCode}, nil
}

func (a *Adapter) pruneNonces() {
	cutoff := time.Now().Add(-2 * time.Minute)
	a.nonces.Range(func(key, value any) bool {
		createdAt, ok := value.(time.Time)
		if !ok || createdAt.Before(cutoff) {
			a.nonces.Delete(key)
		}
		return true
	})
}

func (a *Adapter) Handle(ctx context.Context, method, path string, identity ConnectorIdentity, body map[string]any) (any, string, error) {
	switch {
	case method == http.MethodPost && path == "/runtime/internal/directory-connector/commands/lease":
		result, err := a.Lease(ctx, identity)
		return map[string]any{"command": result}, "directory.commands.lease", err
	case method == http.MethodPost && path == "/runtime/internal/directory-connector/sync":
		result, err := a.ApplySync(ctx, identity, body)
		return result, "directory.sync.apply", err
	case method == http.MethodPost && strings.HasPrefix(path, "/runtime/internal/directory-connector/commands/") && strings.HasSuffix(path, "/complete"):
		operationID := strings.TrimSuffix(strings.TrimPrefix(path, "/runtime/internal/directory-connector/commands/"), "/complete")
		if operationID == "" || strings.Contains(operationID, "/") {
			return nil, "directory.commands.complete", httperror.New(http.StatusNotFound, "not_found", "Route not found")
		}
		result, err := a.Complete(ctx, identity, operationID, body)
		return result, "directory.commands.complete", err
	default:
		return nil, "directory.runtime", httperror.New(http.StatusNotFound, "not_found", fmt.Sprintf("Unsupported Directory Runtime route: %s", path))
	}
}
