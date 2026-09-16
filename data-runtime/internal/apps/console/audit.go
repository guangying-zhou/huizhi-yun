package console

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

var auditCodePattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`)

var lifecycleAuditActions = []string{
	"directory.user.employment.from_people",
	"directory.user.disable.from_people",
	"directory.user.employment_authorization.retry",
	"directory.user.offboarding_authorization.retry",
}

type operationLogRow struct {
	ID         uint64  `json:"id"`
	UID        *string `json:"uid"`
	RealName   *string `json:"real_name"`
	SourceApp  string  `json:"source_app"`
	SessionID  *string `json:"session_id"`
	TargetType *string `json:"target_type"`
	TargetKey  *string `json:"target_key"`
	Action     string  `json:"action"`
	Detail     *string `json:"detail"`
	IPAddress  *string `json:"ip_address"`
	CreatedAt  string  `json:"created_at"`
}

type loginLogRow struct {
	ID            uint64  `json:"id"`
	UID           *string `json:"uid"`
	RealName      *string `json:"real_name"`
	TargetApp     *string `json:"target_app"`
	SessionID     *string `json:"session_id"`
	AuthProvider  string  `json:"auth_provider"`
	LoginType     string  `json:"login_type"`
	LoginResult   int     `json:"login_result"`
	FailureReason *string `json:"failure_reason"`
	IPAddress     *string `json:"ip_address"`
	Location      *string `json:"location"`
	Device        *string `json:"device"`
	Browser       *string `json:"browser"`
	OS            *string `json:"os"`
	CreatedAt     string  `json:"created_at"`
}

type AuditMutationMeta struct {
	IdempotencyKey string
	RequestID      string
	ActorType      string
	ActorID        string
	SourceApp      string
}

func (a *Adapter) OperationLogs(ctx context.Context, query url.Values) (map[string]any, error) {
	page, pageSize, offset := auditPage(query)
	whereSQL, args, err := operationLogWhere(query, "l")
	if err != nil {
		return nil, err
	}
	var total uint64
	if err := a.db.QueryRowContext(ctx, `
		SELECT COUNT(*)
		FROM operation_logs l
		LEFT JOIN directory_users u ON u.uid=l.actor_id
		`+whereSQL, args...).Scan(&total); err != nil {
		return nil, err
	}
	rows, err := a.db.QueryContext(ctx, `
		SELECT l.id,
			CASE WHEN l.actor_type='human' THEN l.actor_id ELSE NULL END,
			u.real_name,l.domain_code,l.request_id,l.target_type,l.target_key,l.action,
			JSON_PRETTY(l.detail_json),
			JSON_UNQUOTE(JSON_EXTRACT(l.detail_json,'$.ipAddress')),
			l.created_at
		FROM operation_logs l
		LEFT JOIN directory_users u ON u.uid=l.actor_id
		`+whereSQL+`
		ORDER BY l.created_at DESC
		LIMIT ? OFFSET ?`, append(args, pageSize, offset)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]operationLogRow, 0)
	for rows.Next() {
		var row operationLogRow
		var uid, realName, sessionID, targetType, targetKey, detail, ip sql.NullString
		var createdAt time.Time
		if err := rows.Scan(
			&row.ID, &uid, &realName, &row.SourceApp, &sessionID, &targetType,
			&targetKey, &row.Action, &detail, &ip, &createdAt,
		); err != nil {
			return nil, err
		}
		row.UID, row.RealName = nullStringPointer(uid), nullStringPointer(realName)
		row.SessionID, row.TargetType = nullStringPointer(sessionID), nullStringPointer(targetType)
		row.TargetKey, row.Detail, row.IPAddress = nullStringPointer(targetKey), nullStringPointer(detail), nullStringPointer(ip)
		row.CreatedAt = createdAt.UTC().Format(time.RFC3339)
		items = append(items, row)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return pagedAuditResponse(items, page, pageSize, total), nil
}

func (a *Adapter) LoginLogs(ctx context.Context, query url.Values) (map[string]any, error) {
	page, pageSize, offset := auditPage(query)
	whereSQL, args, err := loginLogWhere(query)
	if err != nil {
		return nil, err
	}
	var total uint64
	if err := a.db.QueryRowContext(ctx, `
		SELECT COUNT(*)
		FROM auth_login_events l
		LEFT JOIN directory_users u ON u.uid=l.uid
		`+whereSQL, args...).Scan(&total); err != nil {
		return nil, err
	}
	rows, err := a.db.QueryContext(ctx, `
		SELECT l.id,l.uid,u.real_name,l.target_app,l.session_id,l.auth_provider,
			l.login_type,l.login_result,l.failure_reason,l.ip_address,l.location,
			l.device_summary,l.browser,l.os,l.created_at
		FROM auth_login_events l
		LEFT JOIN directory_users u ON u.uid=l.uid
		`+whereSQL+`
		ORDER BY l.created_at DESC
		LIMIT ? OFFSET ?`, append(args, pageSize, offset)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]loginLogRow, 0)
	for rows.Next() {
		var row loginLogRow
		var uid, realName, targetApp, sessionID, failure, ip, location, device, browser, osValue sql.NullString
		var loginResult string
		var createdAt time.Time
		if err := rows.Scan(
			&row.ID, &uid, &realName, &targetApp, &sessionID, &row.AuthProvider,
			&row.LoginType, &loginResult, &failure, &ip, &location, &device,
			&browser, &osValue, &createdAt,
		); err != nil {
			return nil, err
		}
		row.UID, row.RealName = nullStringPointer(uid), nullStringPointer(realName)
		row.TargetApp, row.SessionID = nullStringPointer(targetApp), nullStringPointer(sessionID)
		row.FailureReason, row.IPAddress = nullStringPointer(failure), nullStringPointer(ip)
		row.Location, row.Device = nullStringPointer(location), nullStringPointer(device)
		row.Browser, row.OS = nullStringPointer(browser), nullStringPointer(osValue)
		if loginResult == "success" {
			row.LoginResult = 1
		}
		row.CreatedAt = createdAt.UTC().Format(time.RFC3339)
		items = append(items, row)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return pagedAuditResponse(items, page, pageSize, total), nil
}

func (a *Adapter) LifecycleAuditMetrics(ctx context.Context, query url.Values) (map[string]any, error) {
	scoped := cloneValues(query)
	scoped.Set("source_app", firstValue(scoped.Get("source_app"), "directory"))
	scoped.Set("action_group", "lifecycle_authorization")
	whereSQL, args, err := operationLogWhere(scoped, "l")
	if err != nil {
		return nil, err
	}
	failed := lifecycleFailureSQL("l")
	retry := lifecycleRetrySQL("l")
	var total, success, failedCount, retryTotal, retrySuccess, retryFailed, affectedUsers uint64
	var latestFailure, lastSuccess sql.NullTime
	if err := a.db.QueryRowContext(ctx, `
		SELECT COUNT(*),
			COALESCE(SUM(CASE WHEN `+failed+` THEN 0 ELSE 1 END),0),
			COALESCE(SUM(CASE WHEN `+failed+` THEN 1 ELSE 0 END),0),
			COALESCE(SUM(CASE WHEN `+retry+` THEN 1 ELSE 0 END),0),
			COALESCE(SUM(CASE WHEN `+retry+` AND NOT `+failed+` THEN 1 ELSE 0 END),0),
			COALESCE(SUM(CASE WHEN `+retry+` AND `+failed+` THEN 1 ELSE 0 END),0),
			COUNT(DISTINCT NULLIF(l.target_key,'')),
			MAX(CASE WHEN `+failed+` THEN l.created_at ELSE NULL END),
			MAX(CASE WHEN NOT `+failed+` THEN l.created_at ELSE NULL END)
		FROM operation_logs l
		LEFT JOIN directory_users u ON u.uid=l.actor_id
		`+whereSQL, args...).Scan(
		&total, &success, &failedCount, &retryTotal, &retrySuccess, &retryFailed,
		&affectedUsers, &latestFailure, &lastSuccess,
	); err != nil {
		return nil, err
	}
	pendingWhere := appendAuditCondition(whereSQL, `
		l.action IN ('directory.user.employment.from_people','directory.user.disable.from_people')
		AND `+failed+`
		AND NOT EXISTS (
			SELECT 1 FROM operation_logs r
			WHERE r.domain_code=l.domain_code AND r.target_key=l.target_key
				AND r.created_at>=l.created_at
				AND ((l.action='directory.user.employment.from_people'
						AND r.action='directory.user.employment_authorization.retry')
					OR (l.action='directory.user.disable.from_people'
						AND r.action='directory.user.offboarding_authorization.retry'))
				AND NOT `+lifecycleFailureSQL("r")+`
		)`)
	var pending uint64
	if err := a.db.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM operation_logs l
		LEFT JOIN directory_users u ON u.uid=l.actor_id
		`+pendingWhere, args...).Scan(&pending); err != nil {
		return nil, err
	}
	byAction, err := a.lifecycleMetricsByAction(ctx, whereSQL, args, failed)
	if err != nil {
		return nil, err
	}
	trend, err := a.lifecycleMetricsTrend(ctx, whereSQL, args, failed, retry)
	if err != nil {
		return nil, err
	}
	return map[string]any{"code": 0, "message": "success", "data": map[string]any{
		"total": total, "success": success, "failed": failedCount,
		"retry": retryTotal, "retrySuccess": retrySuccess, "retryFailed": retryFailed,
		"pendingFailure": pending, "affectedUsers": affectedUsers,
		"latestFailureAt": nullableAuditTime(latestFailure), "lastSuccessAt": nullableAuditTime(lastSuccess),
		"byAction": byAction, "trend": trend, "generatedAt": time.Now().UTC().Format(time.RFC3339),
	}}, nil
}

func (a *Adapter) AppendOperationLog(ctx context.Context, body map[string]any, meta AuditMutationMeta) (map[string]any, error) {
	action, err := requiredAuditCode(body["action"], "action")
	if err != nil {
		return nil, err
	}
	sourceApp, err := requiredAuditCode(firstValue(stringField(body["sourceApp"]), meta.SourceApp), "sourceApp")
	if err != nil {
		return nil, err
	}
	if meta.SourceApp != "" && sourceApp != meta.SourceApp {
		return nil, httperror.New(http.StatusForbidden, "audit_source_mismatch", "sourceApp does not match the verified service identity")
	}
	targetType := firstValue(strings.TrimSpace(stringField(body["targetType"])), "unknown")
	if !auditCodePattern.MatchString(targetType) {
		return nil, httperror.New(http.StatusBadRequest, "audit_target_type_invalid", "targetType is invalid")
	}
	detail, err := sanitizeAuditDetail(body["detail"])
	if err != nil {
		return nil, err
	}
	result := firstValue(strings.TrimSpace(stringField(body["result"])), "success")
	if result != "success" && result != "failed" {
		return nil, httperror.New(http.StatusBadRequest, "audit_result_invalid", "result must be success or failed")
	}
	detail["result"] = result
	if ip := nullableLimitedString(body["ipAddress"], 64); ip != nil {
		detail["ipAddress"] = *ip
	}
	payload := map[string]any{
		"sourceApp": sourceApp, "action": action, "targetType": targetType,
		"targetKey":   nullableLimitedString(body["targetId"], 128),
		"sessionId":   nullableLimitedString(body["sessionId"], 64),
		"operatorUid": nullableLimitedString(body["operatorUid"], 128),
		"detail":      detail,
	}
	session, replay, err := a.beginMutationAs(
		ctx, "console.audit.operation.append", meta.IdempotencyKey, meta.RequestID,
		meta.ActorType, meta.ActorID, payload,
	)
	if err != nil || replay != nil {
		return replay, err
	}
	defer session.tx.Rollback()
	actorType := meta.ActorType
	actorID := meta.ActorID
	if operator := nullableLimitedString(body["operatorUid"], 128); operator != nil {
		actorType, actorID = "human", *operator
	}
	detailJSON, _ := json.Marshal(detail)
	if _, err := session.tx.ExecContext(ctx, `
		INSERT INTO operation_logs (
			domain_code,action,target_type,target_key,actor_type,actor_id,request_id,detail_json,created_at
		) VALUES (?,?,?,?,?,?,?,?,UTC_TIMESTAMP())
	`, sourceApp, action, targetType, nullableLimitedString(body["targetId"], 128),
		actorType, actorID, nullableLimitedString(body["sessionId"], 64), detailJSON); err != nil {
		return nil, err
	}
	response := map[string]any{"code": 0, "message": "success", "data": nil}
	if err := finishMutationReceipt(ctx, session, response); err != nil {
		return nil, err
	}
	return response, nil
}

func (a *Adapter) AppendLoginLog(ctx context.Context, body map[string]any, meta AuditMutationMeta) (map[string]any, error) {
	loginType, err := requiredAuditCode(body["loginType"], "loginType")
	if err != nil {
		return nil, err
	}
	authProvider, err := requiredAuditCode(firstValue(stringField(body["authProvider"]), "local"), "authProvider")
	if err != nil {
		return nil, err
	}
	targetApp, err := requiredAuditCode(firstValue(stringField(body["targetApp"]), meta.SourceApp), "targetApp")
	if err != nil {
		return nil, err
	}
	var identityID any
	if rawIdentityID, present := body["identityId"]; present && rawIdentityID != nil {
		parsedIdentityID, ok := integerField(rawIdentityID)
		if !ok || parsedIdentityID <= 0 {
			return nil, httperror.New(http.StatusBadRequest, "login_identity_id_invalid", "identityId must be a positive integer")
		}
		identityID = parsedIdentityID
	}
	loginResult, ok := integerField(body["loginResult"])
	if !ok || (loginResult != 0 && loginResult != 1) {
		return nil, httperror.New(http.StatusBadRequest, "login_result_invalid", "loginResult must be 0 or 1")
	}
	payload := map[string]any{
		"uid": nullableLimitedString(body["uid"], 64), "identityId": identityID,
		"targetApp": targetApp, "authProvider": authProvider,
		"loginType": loginType, "loginResult": loginResult,
		"failureReason": nullableLimitedString(body["failureReason"], 500),
		"sessionId":     nullableLimitedString(body["sessionId"], 128),
		"ipAddress":     nullableLimitedString(body["ipAddress"], 64),
		"location":      nullableLimitedString(body["location"], 128),
		"device":        nullableLimitedString(body["device"], 255),
		"browser":       nullableLimitedString(body["browser"], 128),
		"os":            nullableLimitedString(body["os"], 128),
	}
	session, replay, err := a.beginMutationAs(
		ctx, "console.audit.login.append", meta.IdempotencyKey, meta.RequestID,
		meta.ActorType, meta.ActorID, payload,
	)
	if err != nil || replay != nil {
		return replay, err
	}
	defer session.tx.Rollback()
	result := "failed"
	if loginResult == 1 {
		result = "success"
	}
	if _, err := session.tx.ExecContext(ctx, `
		INSERT INTO auth_login_events (
			uid,identity_id,target_app,auth_provider,login_type,login_result,failure_reason,
			ip_address,location,device_summary,browser,os,session_id,created_at
		) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP())
	`, nullableLimitedString(body["uid"], 64), identityID, targetApp, authProvider, loginType, result,
		nullableLimitedString(body["failureReason"], 500), nullableLimitedString(body["ipAddress"], 64),
		nullableLimitedString(body["location"], 128),
		nullableLimitedString(body["device"], 255), nullableLimitedString(body["browser"], 128),
		nullableLimitedString(body["os"], 128), nullableLimitedString(body["sessionId"], 128)); err != nil {
		return nil, err
	}
	response := map[string]any{"code": 0, "message": "success", "data": nil}
	if err := finishMutationReceipt(ctx, session, response); err != nil {
		return nil, err
	}
	return response, nil
}

func (a *Adapter) lifecycleMetricsByAction(ctx context.Context, whereSQL string, args []any, failed string) ([]map[string]any, error) {
	rows, err := a.db.QueryContext(ctx, `
		SELECT l.action,COUNT(*),
			COALESCE(SUM(CASE WHEN `+failed+` THEN 0 ELSE 1 END),0),
			COALESCE(SUM(CASE WHEN `+failed+` THEN 1 ELSE 0 END),0),
			MAX(l.created_at)
		FROM operation_logs l
		LEFT JOIN directory_users u ON u.uid=l.actor_id
		`+whereSQL+`
		GROUP BY l.action
		ORDER BY FIELD(l.action,
			'directory.user.employment.from_people',
			'directory.user.disable.from_people',
			'directory.user.employment_authorization.retry',
			'directory.user.offboarding_authorization.retry')`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]map[string]any, 0)
	for rows.Next() {
		var action string
		var total, success, failedCount uint64
		var latest sql.NullTime
		if err := rows.Scan(&action, &total, &success, &failedCount, &latest); err != nil {
			return nil, err
		}
		items = append(items, map[string]any{
			"action": action, "total": total, "success": success, "failed": failedCount,
			"latestAt": nullableAuditTime(latest),
		})
	}
	return items, rows.Err()
}

func (a *Adapter) lifecycleMetricsTrend(ctx context.Context, whereSQL string, args []any, failed string, retry string) ([]map[string]any, error) {
	rows, err := a.db.QueryContext(ctx, `
		SELECT * FROM (
			SELECT DATE_FORMAT(l.created_at,'%Y-%m-%d'),COUNT(*),
				COALESCE(SUM(CASE WHEN `+failed+` THEN 0 ELSE 1 END),0),
				COALESCE(SUM(CASE WHEN `+failed+` THEN 1 ELSE 0 END),0),
				COALESCE(SUM(CASE WHEN `+retry+` THEN 1 ELSE 0 END),0)
			FROM operation_logs l
			LEFT JOIN directory_users u ON u.uid=l.actor_id
			`+whereSQL+`
			GROUP BY DATE_FORMAT(l.created_at,'%Y-%m-%d')
			ORDER BY DATE_FORMAT(l.created_at,'%Y-%m-%d') DESC LIMIT 14
		) trend ORDER BY 1`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]map[string]any, 0)
	for rows.Next() {
		var date string
		var total, success, failedCount, retryTotal uint64
		if err := rows.Scan(&date, &total, &success, &failedCount, &retryTotal); err != nil {
			return nil, err
		}
		items = append(items, map[string]any{
			"date": date, "total": total, "success": success, "failed": failedCount, "retry": retryTotal,
		})
	}
	return items, rows.Err()
}

func operationLogWhere(query url.Values, alias string) (string, []any, error) {
	where := make([]string, 0, 7)
	args := make([]any, 0, 12)
	if uid := boundedQuery(query, "uid", 128); uid != "" {
		where = append(where, "("+alias+".actor_id LIKE ? OR u.real_name LIKE ? OR "+alias+".target_key LIKE ?)")
		like := "%" + uid + "%"
		args = append(args, like, like, like)
	}
	if source := boundedQuery(query, "source_app", 64); source != "" {
		where = append(where, alias+".domain_code=?")
		args = append(args, source)
	}
	if requestID := boundedQuery(query, "session_id", 64); requestID != "" {
		where = append(where, alias+".request_id=?")
		args = append(args, requestID)
	}
	if query.Get("action_group") == "lifecycle_authorization" {
		placeholders := make([]string, len(lifecycleAuditActions))
		for index, action := range lifecycleAuditActions {
			placeholders[index] = "?"
			args = append(args, action)
		}
		where = append(where, alias+".action IN ("+strings.Join(placeholders, ",")+")")
	}
	if action := boundedQuery(query, "action", 128); action != "" {
		where = append(where, alias+".action LIKE ?")
		args = append(args, "%"+action+"%")
	}
	if start := boundedQuery(query, "start_date", 10); start != "" {
		if !validAuditDate(start) {
			return "", nil, httperror.New(http.StatusBadRequest, "audit_date_invalid", "start_date must be YYYY-MM-DD")
		}
		where = append(where, alias+".created_at>=?")
		args = append(args, start)
	}
	if end := boundedQuery(query, "end_date", 10); end != "" {
		if !validAuditDate(end) {
			return "", nil, httperror.New(http.StatusBadRequest, "audit_date_invalid", "end_date must be YYYY-MM-DD")
		}
		where = append(where, alias+".created_at<=?")
		args = append(args, end+" 23:59:59")
	}
	if len(where) == 0 {
		return "", args, nil
	}
	return "WHERE " + strings.Join(where, " AND "), args, nil
}

func loginLogWhere(query url.Values) (string, []any, error) {
	where := make([]string, 0, 7)
	args := make([]any, 0, 10)
	if uid := boundedQuery(query, "uid", 128); uid != "" {
		where = append(where, "(l.uid LIKE ? OR u.real_name LIKE ?)")
		args = append(args, "%"+uid+"%", "%"+uid+"%")
	}
	if target := boundedQuery(query, "target_app", 64); target != "" {
		where = append(where, "l.target_app=?")
		args = append(args, target)
	}
	if sessionID := boundedQuery(query, "session_id", 128); sessionID != "" {
		where = append(where, "l.session_id=?")
		args = append(args, sessionID)
	}
	if value := strings.TrimSpace(query.Get("login_result")); value != "" {
		result := "failed"
		if value == "1" || value == "success" {
			result = "success"
		}
		where = append(where, "l.login_result=?")
		args = append(args, result)
	}
	if loginType := boundedQuery(query, "login_type", 32); loginType != "" {
		switch loginType {
		case "wecom", "dingtalk":
			where = append(where, "(l.login_type=? OR l.auth_provider=?)")
			args = append(args, loginType, loginType)
		case "oauth":
			where = append(where, "(l.login_type='oauth' AND COALESCE(l.auth_provider,'') NOT IN ('wecom','dingtalk'))")
		default:
			where = append(where, "l.login_type=?")
			args = append(args, loginType)
		}
	}
	for _, field := range []string{"start_date", "end_date"} {
		if value := boundedQuery(query, field, 10); value != "" {
			if !validAuditDate(value) {
				return "", nil, httperror.New(http.StatusBadRequest, "audit_date_invalid", field+" must be YYYY-MM-DD")
			}
			operator := ">="
			if field == "end_date" {
				operator, value = "<=", value+" 23:59:59"
			}
			where = append(where, "l.created_at"+operator+"?")
			args = append(args, value)
		}
	}
	if len(where) == 0 {
		return "", args, nil
	}
	return "WHERE " + strings.Join(where, " AND "), args, nil
}

func pagedAuditResponse(items any, page int, pageSize int, total uint64) map[string]any {
	totalPages := uint64(0)
	if total > 0 {
		totalPages = (total + uint64(pageSize) - 1) / uint64(pageSize)
	}
	return map[string]any{"code": 0, "message": "success", "data": map[string]any{
		"items": items, "page": page, "pageSize": pageSize, "total": total, "totalPages": totalPages,
	}}
}

func auditPage(query url.Values) (int, int, int) {
	page := positiveIntQuery(query.Get("page"), 1)
	pageSize := positiveIntQuery(query.Get("pageSize"), 20)
	if pageSize > 100 {
		pageSize = 100
	}
	return page, pageSize, (page - 1) * pageSize
}

func positiveIntQuery(value string, fallback int) int {
	parsed, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil || parsed < 1 {
		return fallback
	}
	return parsed
}

func boundedQuery(query url.Values, key string, limit int) string {
	value := strings.TrimSpace(query.Get(key))
	if len(value) > limit {
		return value[:limit]
	}
	return value
}

func validAuditDate(value string) bool {
	_, err := time.Parse("2006-01-02", value)
	return err == nil
}

func requiredAuditCode(value any, field string) (string, error) {
	code := strings.TrimSpace(fmt.Sprint(value))
	if code == "" || code == "<nil>" || !auditCodePattern.MatchString(code) {
		return "", httperror.New(http.StatusBadRequest, "audit_"+strings.ToLower(field)+"_invalid", field+" is invalid")
	}
	return code, nil
}

func integerField(value any) (int, bool) {
	switch typed := value.(type) {
	case float64:
		return int(typed), typed == float64(int(typed))
	case int:
		return typed, true
	case json.Number:
		parsed, err := strconv.Atoi(typed.String())
		return parsed, err == nil
	default:
		parsed, err := strconv.Atoi(strings.TrimSpace(fmt.Sprint(value)))
		return parsed, err == nil
	}
}

func nullableLimitedString(value any, limit int) *string {
	text := strings.TrimSpace(fmt.Sprint(value))
	if text == "" || text == "<nil>" {
		return nil
	}
	if len(text) > limit {
		text = text[:limit]
	}
	return &text
}

func sanitizeAuditDetail(value any) (map[string]any, error) {
	var detail map[string]any
	switch typed := value.(type) {
	case nil:
		detail = map[string]any{}
	case string:
		detail = map[string]any{"detail": typed}
	case map[string]any:
		detail = typed
	default:
		return nil, httperror.New(http.StatusBadRequest, "audit_detail_invalid", "detail must be an object or string")
	}
	sanitized := redactAuditValue(detail).(map[string]any)
	encoded, err := json.Marshal(sanitized)
	if err != nil {
		return nil, httperror.New(http.StatusBadRequest, "audit_detail_invalid", "detail is not valid JSON")
	}
	if len(encoded) > 32*1024 {
		return nil, httperror.New(http.StatusRequestEntityTooLarge, "audit_detail_too_large", "detail exceeds 32 KiB")
	}
	return sanitized, nil
}

func redactAuditValue(value any) any {
	switch typed := value.(type) {
	case map[string]any:
		result := make(map[string]any, len(typed))
		for key, item := range typed {
			if auditSensitiveKey(key) {
				result[key] = "[REDACTED]"
			} else {
				result[key] = redactAuditValue(item)
			}
		}
		return result
	case []any:
		result := make([]any, len(typed))
		for index, item := range typed {
			result[index] = redactAuditValue(item)
		}
		return result
	default:
		return typed
	}
}

func auditSensitiveKey(key string) bool {
	normalized := strings.ToLower(strings.NewReplacer("_", "", "-", "", ".", "").Replace(key))
	for _, forbidden := range []string{
		"password", "passwd", "secret", "token", "authorization", "cookie", "dsn",
		"privatekey", "credential", "ciphertext", "accesskey", "clientsecret",
	} {
		if strings.Contains(normalized, forbidden) {
			return true
		}
	}
	return false
}

func nullStringPointer(value sql.NullString) *string {
	if !value.Valid {
		return nil
	}
	return &value.String
}

func nullableAuditTime(value sql.NullTime) any {
	if !value.Valid {
		return nil
	}
	return value.Time.UTC().Format(time.RFC3339)
}

func lifecycleFailureSQL(alias string) string {
	return `(
		JSON_UNQUOTE(JSON_EXTRACT(` + alias + `.detail_json,'$.result'))='failed'
		OR JSON_UNQUOTE(JSON_EXTRACT(` + alias + `.detail_json,'$.authorizationSync.ok'))='false'
		OR JSON_UNQUOTE(JSON_EXTRACT(` + alias + `.detail_json,'$.authorizationReclaim.ok'))='false'
		OR JSON_EXTRACT(` + alias + `.detail_json,'$.error') IS NOT NULL
		OR JSON_EXTRACT(` + alias + `.detail_json,'$.authorizationSync.error') IS NOT NULL
		OR JSON_EXTRACT(` + alias + `.detail_json,'$.authorizationReclaim.error') IS NOT NULL
	)`
}

func lifecycleRetrySQL(alias string) string {
	return alias + `.action IN (
		'directory.user.employment_authorization.retry',
		'directory.user.offboarding_authorization.retry'
	)`
}

func appendAuditCondition(whereSQL string, condition string) string {
	if whereSQL == "" {
		return "WHERE " + condition
	}
	return whereSQL + " AND " + condition
}

func cloneValues(values url.Values) url.Values {
	result := make(url.Values, len(values))
	for key, entries := range values {
		result[key] = append([]string(nil), entries...)
	}
	return result
}
