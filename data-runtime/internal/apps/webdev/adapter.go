package webdev

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/config"
	"github.com/huizhi-yun/data-runtime/internal/db"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type Adapter struct {
	db     *sql.DB
	dbName string
}

type DataResult[T any] struct {
	Data T `json:"data"`
}

type SchemaStatus struct {
	App           string   `json:"app"`
	Database      string   `json:"database"`
	Status        string   `json:"status"`
	CheckedTables []string `json:"checkedTables"`
	MissingTables []string `json:"missingTables"`
}

type Project struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Status string `json:"status"`
}

type Agent struct {
	ID        string  `json:"id"`
	OwnerUID  string  `json:"ownerUid"`
	Endpoint  string  `json:"endpoint"`
	Status    string  `json:"status"`
	LastSeen  *string `json:"lastSeenAt,omitempty"`
	Version   string  `json:"version"`
	UpdatedAt *string `json:"updatedAt,omitempty"`
}

type Job struct {
	ID         string  `json:"id"`
	ProjectID  string  `json:"projectId"`
	RepoID     string  `json:"repoId"`
	AgentID    string  `json:"agentId"`
	Type       string  `json:"type"`
	Status     string  `json:"status"`
	TemplateID string  `json:"templateId"`
	Target     string  `json:"target"`
	Prompt     string  `json:"prompt,omitempty"`
	CreatedBy  string  `json:"createdBy"`
	CreatedAt  string  `json:"createdAt"`
	StartedAt  *string `json:"startedAt,omitempty"`
	FinishedAt *string `json:"finishedAt,omitempty"`
	ExitCode   *int    `json:"exitCode,omitempty"`
	Error      string  `json:"error,omitempty"`
	EventCount int64   `json:"eventCount"`
}

type Event struct {
	JobID     string `json:"jobId"`
	Sequence  int64  `json:"sequence"`
	Level     string `json:"level"`
	Message   string `json:"message"`
	CreatedAt string `json:"createdAt"`
}

type JobList struct {
	Items    []Job `json:"items"`
	Total    int64 `json:"total"`
	Page     int   `json:"page"`
	PageSize int   `json:"pageSize"`
}

type pageParams struct {
	page     int
	pageSize int
	offset   int
}

type Issue struct {
	ID           string          `json:"id"`
	DisplayNo    int64           `json:"displayNo"`
	ProjectID    string          `json:"projectId"`
	AppCode      string          `json:"appCode"`
	Scope        string          `json:"scope"`
	PageKey      string          `json:"pageKey"`
	PageURL      string          `json:"pageUrl"`
	RepoID       string          `json:"repoId"`
	Tenant       string          `json:"tenant"`
	Fingerprint  string          `json:"fingerprint,omitempty"`
	Severity     string          `json:"severity"`
	Kind         string          `json:"kind"`
	State        string          `json:"state"`
	Title        string          `json:"title"`
	Description  string          `json:"description,omitempty"`
	ReporterUID  string          `json:"reporterUid"`
	ReporterName string          `json:"reporterName"`
	AssigneeUID  string          `json:"assigneeUid,omitempty"`
	Context      json.RawMessage `json:"context,omitempty"`
	LinkedJobID  string          `json:"linkedJobId,omitempty"`
	ClaimToken   string          `json:"claimToken,omitempty"`
	Source       string          `json:"source"`
	AutoClaimed  bool            `json:"autoClaimed"`
	ClaimedAt    *string         `json:"claimedAt,omitempty"`
	CreatedAt    string          `json:"createdAt"`
	UpdatedAt    *string         `json:"updatedAt,omitempty"`
	Events       []IssueEvent    `json:"events,omitempty"`
}

type IssueEvent struct {
	ID        int64           `json:"id"`
	IssueID   string          `json:"issueId"`
	Actor     string          `json:"actor"`
	Action    string          `json:"action"`
	Detail    json.RawMessage `json:"detail,omitempty"`
	CreatedAt string          `json:"createdAt"`
}

type IssueList struct {
	Items    []Issue `json:"items"`
	Total    int64   `json:"total"`
	Page     int     `json:"page"`
	PageSize int     `json:"pageSize"`
}

// ClaimResult 表示一次领取尝试的结果（见 WebDev Issue 设计 §8）。
type ClaimResult struct {
	Claimed       bool  `json:"claimed"`       // 本次成功抢到领取锁
	AlreadyLinked bool  `json:"alreadyLinked"` // 已有关联任务
	Issue         Issue `json:"issue"`
}

// IssueSettings 自动领取规则（按租户单条配置）。
type IssueSettings struct {
	Tenant           string   `json:"tenant"`
	AutoClaimEnabled bool     `json:"autoClaimEnabled"`
	SeverityMin      string   `json:"severityMin"`
	Kinds            []string `json:"kinds"`
	Apps             []string `json:"apps"`
}

var requiredTables = []string{
	"webdev_agents",
	"webdev_projects",
	"webdev_project_repos",
	"webdev_command_templates",
	"webdev_jobs",
	"webdev_job_events",
	"webdev_job_artifacts",
	"webdev_deployments",
	"webdev_issues",
	"webdev_issue_events",
	"webdev_issue_counters",
	"webdev_issue_settings",
}

func New(cfg config.WebDevConfig) (*Adapter, error) {
	conn, err := db.Open(cfg.DB)
	if err != nil {
		return nil, err
	}
	return &Adapter{db: conn, dbName: cfg.DB.Database}, nil
}

func (a *Adapter) Ping(ctx context.Context) error {
	return a.db.PingContext(ctx)
}

func (a *Adapter) SchemaStatus(ctx context.Context) (SchemaStatus, error) {
	placeholders := strings.TrimRight(strings.Repeat("?,", len(requiredTables)), ",")
	args := make([]any, 0, len(requiredTables))
	for _, table := range requiredTables {
		args = append(args, table)
	}

	rows, err := a.db.QueryContext(ctx, `
		SELECT TABLE_NAME
		FROM information_schema.TABLES
		WHERE TABLE_SCHEMA = DATABASE()
		  AND TABLE_NAME IN (`+placeholders+`)
	`, args...)
	if err != nil {
		return SchemaStatus{}, err
	}
	defer rows.Close()

	existing := map[string]bool{}
	for rows.Next() {
		var table string
		if err := rows.Scan(&table); err != nil {
			return SchemaStatus{}, err
		}
		existing[table] = true
	}
	if err := rows.Err(); err != nil {
		return SchemaStatus{}, err
	}

	missing := make([]string, 0)
	for _, table := range requiredTables {
		if !existing[table] {
			missing = append(missing, table)
		}
	}

	status := "ok"
	if len(missing) > 0 {
		status = "schema_mismatch"
	}
	return SchemaStatus{
		App:           "webdev",
		Database:      a.dbName,
		Status:        status,
		CheckedTables: requiredTables,
		MissingTables: missing,
	}, nil
}

func (a *Adapter) HandleRuntime(ctx context.Context, method string, path string, query url.Values, body map[string]any) (any, string, error) {
	switch {
	case method == http.MethodGet && path == "/v1/webdev/projects":
		result, err := a.ListProjects(ctx)
		return result, "webdev.projects.list", err
	case method == http.MethodGet && path == "/v1/webdev/agents":
		result, err := a.ListAgents(ctx)
		return result, "webdev.agents.list", err
	case method == http.MethodGet && path == "/v1/webdev/jobs":
		result, err := a.ListJobs(ctx, query)
		return result, "webdev.jobs.list", err
	case method == http.MethodPost && path == "/v1/webdev/jobs":
		result, err := a.CreateJob(ctx, body)
		return result, "webdev.jobs.create", err
	case method == http.MethodGet && strings.HasPrefix(path, "/v1/webdev/jobs/") && strings.HasSuffix(path, "/events"):
		id := strings.TrimSuffix(strings.TrimPrefix(path, "/v1/webdev/jobs/"), "/events")
		result, err := a.ListEvents(ctx, id, query)
		return result, "webdev.job_events.list", err
	case method == http.MethodPost && strings.HasPrefix(path, "/v1/webdev/jobs/") && strings.HasSuffix(path, "/events"):
		id := strings.TrimSuffix(strings.TrimPrefix(path, "/v1/webdev/jobs/"), "/events")
		result, err := a.CreateEvent(ctx, id, body)
		return result, "webdev.job_events.create", err
	case method == http.MethodGet && strings.HasPrefix(path, "/v1/webdev/jobs/"):
		id := strings.TrimPrefix(path, "/v1/webdev/jobs/")
		result, err := a.GetJob(ctx, id)
		return result, "webdev.jobs.get", err
	case method == http.MethodPatch && strings.HasPrefix(path, "/v1/webdev/jobs/"):
		id := strings.TrimPrefix(path, "/v1/webdev/jobs/")
		result, err := a.UpdateJob(ctx, id, body)
		return result, "webdev.jobs.update", err
	case method == http.MethodGet && path == "/v1/webdev/issues":
		result, err := a.ListIssues(ctx, query)
		return result, "webdev.issues.list", err
	case method == http.MethodPost && path == "/v1/webdev/issues":
		result, err := a.CreateIssue(ctx, body)
		return result, "webdev.issues.create", err
	case method == http.MethodGet && path == "/v1/webdev/issues/settings":
		result, err := a.GetIssueSettings(ctx, query.Get("tenant"))
		return result, "webdev.issue_settings.get", err
	case method == http.MethodPut && path == "/v1/webdev/issues/settings":
		result, err := a.UpdateIssueSettings(ctx, body)
		return result, "webdev.issue_settings.update", err
	case method == http.MethodPost && strings.HasPrefix(path, "/v1/webdev/issues/") && strings.HasSuffix(path, "/claim"):
		id := strings.TrimSuffix(strings.TrimPrefix(path, "/v1/webdev/issues/"), "/claim")
		result, err := a.ClaimIssue(ctx, id, body)
		return result, "webdev.issues.claim", err
	case method == http.MethodPost && strings.HasPrefix(path, "/v1/webdev/issues/") && strings.HasSuffix(path, "/events"):
		id := strings.TrimSuffix(strings.TrimPrefix(path, "/v1/webdev/issues/"), "/events")
		result, err := a.CreateIssueEvent(ctx, id, body)
		return result, "webdev.issue_events.create", err
	case method == http.MethodGet && strings.HasPrefix(path, "/v1/webdev/issues/"):
		id := strings.TrimPrefix(path, "/v1/webdev/issues/")
		result, err := a.GetIssue(ctx, id)
		return result, "webdev.issues.get", err
	case method == http.MethodPatch && strings.HasPrefix(path, "/v1/webdev/issues/"):
		id := strings.TrimPrefix(path, "/v1/webdev/issues/")
		result, err := a.UpdateIssue(ctx, id, body)
		return result, "webdev.issues.update", err
	default:
		return nil, "", httperror.New(http.StatusNotFound, "not_found", "Route not found")
	}
}

func (a *Adapter) ListProjects(ctx context.Context) (DataResult[[]Project], error) {
	rows, err := a.db.QueryContext(ctx, `
		SELECT project_id, name, status
		FROM webdev_projects
		ORDER BY project_id
	`)
	if err != nil {
		return DataResult[[]Project]{}, err
	}
	defer rows.Close()

	items := []Project{}
	for rows.Next() {
		var item Project
		if err := rows.Scan(&item.ID, &item.Name, &item.Status); err != nil {
			return DataResult[[]Project]{}, err
		}
		items = append(items, item)
	}
	return DataResult[[]Project]{Data: items}, rows.Err()
}

func (a *Adapter) ListAgents(ctx context.Context) (DataResult[[]Agent], error) {
	rows, err := a.db.QueryContext(ctx, `
		SELECT agent_id, owner_uid, endpoint, status, last_seen_at, version, updated_at
		FROM webdev_agents
		ORDER BY agent_id
	`)
	if err != nil {
		return DataResult[[]Agent]{}, err
	}
	defer rows.Close()

	items := []Agent{}
	for rows.Next() {
		var item Agent
		var lastSeen sql.NullString
		var updatedAt sql.NullString
		if err := rows.Scan(&item.ID, &item.OwnerUID, &item.Endpoint, &item.Status, &lastSeen, &item.Version, &updatedAt); err != nil {
			return DataResult[[]Agent]{}, err
		}
		item.LastSeen = nullableString(lastSeen)
		item.UpdatedAt = nullableString(updatedAt)
		items = append(items, item)
	}
	return DataResult[[]Agent]{Data: items}, rows.Err()
}

func (a *Adapter) ListJobs(ctx context.Context, query url.Values) (DataResult[JobList], error) {
	page := parsePage(query)
	where := []string{"1 = 1"}
	args := []any{}

	status := strings.TrimSpace(query.Get("status"))
	if status != "" && status != "all" {
		where = append(where, "j.status = ?")
		args = append(args, status)
	}

	repoID := strings.TrimSpace(query.Get("repoId"))
	if repoID != "" {
		where = append(where, "j.repo_id = ?")
		args = append(args, repoID)
	}

	keyword := strings.TrimSpace(query.Get("keyword"))
	if keyword != "" {
		like := "%" + keyword + "%"
		where = append(where, `(j.job_id LIKE ? OR j.type LIKE ? OR j.repo_id LIKE ? OR j.template_id LIKE ? OR j.target LIKE ? OR j.prompt LIKE ? OR j.error LIKE ?)`)
		args = append(args, like, like, like, like, like, like, like)
	}

	whereSQL := strings.Join(where, " AND ")
	var total int64
	if err := a.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM webdev_jobs j WHERE "+whereSQL, args...).Scan(&total); err != nil {
		return DataResult[JobList]{}, err
	}

	rows, err := a.db.QueryContext(ctx, `
		SELECT j.job_id, j.project_id, j.repo_id, j.agent_id, j.type, j.status, j.template_id,
		       j.target, j.prompt, j.created_by, j.created_at, j.started_at, j.finished_at,
		       j.exit_code, j.error,
		       (SELECT COUNT(*) FROM webdev_job_events e WHERE e.job_id = j.job_id) AS event_count
		FROM webdev_jobs j
		WHERE `+whereSQL+`
		ORDER BY j.created_at DESC, j.job_id DESC
		LIMIT ? OFFSET ?
	`, append(args, page.pageSize, page.offset)...)
	if err != nil {
		return DataResult[JobList]{}, err
	}
	defer rows.Close()

	items := []Job{}
	for rows.Next() {
		item, err := scanJobWithEventCount(rows)
		if err != nil {
			return DataResult[JobList]{}, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return DataResult[JobList]{}, err
	}

	return DataResult[JobList]{Data: JobList{
		Items:    items,
		Total:    total,
		Page:     page.page,
		PageSize: page.pageSize,
	}}, nil
}

func (a *Adapter) CreateJob(ctx context.Context, body map[string]any) (DataResult[Job], error) {
	jobID := stringValue(body, "id")
	if jobID == "" {
		jobID = newID()
	}
	jobType := stringValue(body, "type")
	if jobType == "" {
		return DataResult[Job]{}, httperror.New(http.StatusBadRequest, "missing_type", "Job type is required")
	}
	status := stringDefault(stringValue(body, "status"), "queued")
	createdAt := stringDefault(stringValue(body, "createdAt"), time.Now().UTC().Format(time.RFC3339Nano))
	var exitCode any
	if value, ok := intValue(body, "exitCode"); ok {
		exitCode = value
	}

	_, err := a.db.ExecContext(ctx, `
		INSERT INTO webdev_jobs (
			job_id, project_id, repo_id, agent_id, type, status, template_id,
			target, prompt, created_by, created_at, started_at, finished_at,
			exit_code, error
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON DUPLICATE KEY UPDATE
			project_id = IF(VALUES(project_id) = '', project_id, VALUES(project_id)),
			repo_id = IF(VALUES(repo_id) = '', repo_id, VALUES(repo_id)),
			agent_id = IF(VALUES(agent_id) = '', agent_id, VALUES(agent_id)),
			status = VALUES(status),
			template_id = IF(VALUES(template_id) = '', template_id, VALUES(template_id)),
			target = IF(VALUES(target) = '', target, VALUES(target)),
			prompt = IF(VALUES(prompt) = '', prompt, VALUES(prompt)),
			created_by = IF(VALUES(created_by) = '', created_by, VALUES(created_by)),
			started_at = VALUES(started_at),
			finished_at = VALUES(finished_at),
			exit_code = VALUES(exit_code),
			error = VALUES(error),
			updated_at = CURRENT_TIMESTAMP
	`, jobID,
		stringDefault(stringValue(body, "projectId"), "huizhi-yun"),
		stringDefault(stringValue(body, "repoId"), "huizhi-yun"),
		stringValue(body, "agentId"),
		jobType,
		status,
		stringValue(body, "templateId"),
		stringValue(body, "target"),
		stringValue(body, "prompt"),
		stringValue(body, "createdBy"),
		createdAt,
		nullableStringArg(body, "startedAt"),
		nullableStringArg(body, "finishedAt"),
		exitCode,
		stringValue(body, "error"))
	if err != nil {
		return DataResult[Job]{}, err
	}
	return a.GetJob(ctx, jobID)
}

func (a *Adapter) GetJob(ctx context.Context, id string) (DataResult[Job], error) {
	if invalidID(id) {
		return DataResult[Job]{}, httperror.New(http.StatusNotFound, "job_not_found", "Job not found")
	}
	row := a.db.QueryRowContext(ctx, `
		SELECT job_id, project_id, repo_id, agent_id, type, status, template_id,
		       target, prompt, created_by, created_at, started_at, finished_at,
		       exit_code, error
		FROM webdev_jobs
		WHERE job_id = ?
	`, id)
	job, err := scanJob(row)
	if err != nil {
		if err == sql.ErrNoRows {
			return DataResult[Job]{}, httperror.New(http.StatusNotFound, "job_not_found", "Job not found")
		}
		return DataResult[Job]{}, err
	}
	return DataResult[Job]{Data: job}, nil
}

func (a *Adapter) UpdateJob(ctx context.Context, id string, body map[string]any) (DataResult[Job], error) {
	if invalidID(id) {
		return DataResult[Job]{}, httperror.New(http.StatusNotFound, "job_not_found", "Job not found")
	}

	sets := []string{"updated_at = CURRENT_TIMESTAMP"}
	args := []any{}
	addStringPatch(body, "status", "status", &sets, &args)
	addStringPatch(body, "startedAt", "started_at", &sets, &args)
	addStringPatch(body, "finishedAt", "finished_at", &sets, &args)
	addStringPatch(body, "error", "error", &sets, &args)
	if value, ok := intValue(body, "exitCode"); ok {
		sets = append(sets, "exit_code = ?")
		args = append(args, value)
	}
	args = append(args, id)

	result, err := a.db.ExecContext(ctx, "UPDATE webdev_jobs SET "+strings.Join(sets, ", ")+" WHERE job_id = ?", args...)
	if err != nil {
		return DataResult[Job]{}, err
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		return DataResult[Job]{}, httperror.New(http.StatusNotFound, "job_not_found", "Job not found")
	}
	return a.GetJob(ctx, id)
}

func (a *Adapter) CreateEvent(ctx context.Context, jobID string, body map[string]any) (DataResult[Event], error) {
	if invalidID(jobID) {
		return DataResult[Event]{}, httperror.New(http.StatusNotFound, "job_not_found", "Job not found")
	}
	sequence, ok := int64Value(body, "sequence")
	if !ok || sequence <= 0 {
		var next sql.NullInt64
		if err := a.db.QueryRowContext(ctx, "SELECT COALESCE(MAX(sequence), 0) + 1 FROM webdev_job_events WHERE job_id = ?", jobID).Scan(&next); err != nil {
			return DataResult[Event]{}, err
		}
		sequence = next.Int64
	}
	level := stringDefault(stringValue(body, "level"), "system")
	message := stringValue(body, "message")
	createdAt := stringDefault(stringValue(body, "createdAt"), time.Now().UTC().Format(time.RFC3339Nano))

	_, err := a.db.ExecContext(ctx, `
		INSERT INTO webdev_job_events (job_id, sequence, level, message, created_at)
		VALUES (?, ?, ?, ?, ?)
		ON DUPLICATE KEY UPDATE
			level = VALUES(level),
			message = VALUES(message),
			created_at = VALUES(created_at)
	`, jobID, sequence, level, message, createdAt)
	if err != nil {
		return DataResult[Event]{}, err
	}

	return DataResult[Event]{Data: Event{
		JobID:     jobID,
		Sequence:  sequence,
		Level:     level,
		Message:   message,
		CreatedAt: createdAt,
	}}, nil
}

func (a *Adapter) ListEvents(ctx context.Context, jobID string, query url.Values) (DataResult[[]Event], error) {
	if invalidID(jobID) {
		return DataResult[[]Event]{}, httperror.New(http.StatusNotFound, "job_not_found", "Job not found")
	}
	after, _ := strconv.ParseInt(strings.TrimSpace(query.Get("after")), 10, 64)
	rows, err := a.db.QueryContext(ctx, `
		SELECT job_id, sequence, level, message, created_at
		FROM webdev_job_events
		WHERE job_id = ? AND sequence > ?
		ORDER BY sequence ASC
		LIMIT 1000
	`, jobID, after)
	if err != nil {
		return DataResult[[]Event]{}, err
	}
	defer rows.Close()

	items := []Event{}
	for rows.Next() {
		var item Event
		if err := rows.Scan(&item.JobID, &item.Sequence, &item.Level, &item.Message, &item.CreatedAt); err != nil {
			return DataResult[[]Event]{}, err
		}
		items = append(items, item)
	}
	return DataResult[[]Event]{Data: items}, rows.Err()
}

// ── Issue 收件箱 ──────────────────────────────────────────────

const issueColumns = `issue_id, display_no, project_id, app_code, scope, page_key, page_url, repo_id, tenant,
	fingerprint, severity, kind, state, title, description, reporter_uid, reporter_name, assignee_uid,
	context_json, linked_job_id, claim_token, source, auto_claimed, claimed_at, created_at, updated_at`

func scanIssue(row jobScanner) (Issue, error) {
	var it Issue
	var description, context, claimedAt, updatedAt sql.NullString
	var autoClaimed int64
	if err := row.Scan(
		&it.ID, &it.DisplayNo, &it.ProjectID, &it.AppCode, &it.Scope, &it.PageKey, &it.PageURL, &it.RepoID, &it.Tenant,
		&it.Fingerprint, &it.Severity, &it.Kind, &it.State, &it.Title, &description, &it.ReporterUID, &it.ReporterName, &it.AssigneeUID,
		&context, &it.LinkedJobID, &it.ClaimToken, &it.Source, &autoClaimed, &claimedAt, &it.CreatedAt, &updatedAt,
	); err != nil {
		return Issue{}, err
	}
	it.Description = description.String
	if context.Valid && strings.TrimSpace(context.String) != "" {
		it.Context = json.RawMessage(context.String)
	}
	it.AutoClaimed = autoClaimed != 0
	it.ClaimedAt = nullableString(claimedAt)
	it.UpdatedAt = nullableString(updatedAt)
	return it, nil
}

func (a *Adapter) ListIssues(ctx context.Context, query url.Values) (DataResult[IssueList], error) {
	page := parsePage(query)
	where := []string{"1 = 1"}
	args := []any{}

	addEq := func(param, column string) {
		value := strings.TrimSpace(query.Get(param))
		if value != "" && value != "all" {
			where = append(where, column+" = ?")
			args = append(args, value)
		}
	}
	addEq("tenant", "tenant")
	addEq("state", "state")
	addEq("appCode", "app_code")
	addEq("scope", "scope")
	addEq("pageKey", "page_key")
	addEq("severity", "severity")
	addEq("reporterUid", "reporter_uid")

	if keyword := strings.TrimSpace(query.Get("keyword")); keyword != "" {
		like := "%" + keyword + "%"
		where = append(where, "(issue_id LIKE ? OR title LIKE ? OR description LIKE ? OR app_code LIKE ?)")
		args = append(args, like, like, like, like)
	}

	whereSQL := strings.Join(where, " AND ")
	var total int64
	if err := a.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM webdev_issues WHERE "+whereSQL, args...).Scan(&total); err != nil {
		return DataResult[IssueList]{}, err
	}

	rows, err := a.db.QueryContext(ctx, "SELECT "+issueColumns+` FROM webdev_issues WHERE `+whereSQL+`
		ORDER BY created_at DESC, display_no DESC LIMIT ? OFFSET ?`, append(args, page.pageSize, page.offset)...)
	if err != nil {
		return DataResult[IssueList]{}, err
	}
	defer rows.Close()

	items := []Issue{}
	for rows.Next() {
		item, err := scanIssue(rows)
		if err != nil {
			return DataResult[IssueList]{}, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return DataResult[IssueList]{}, err
	}

	return DataResult[IssueList]{Data: IssueList{Items: items, Total: total, Page: page.page, PageSize: page.pageSize}}, nil
}

func (a *Adapter) getIssueRow(ctx context.Context, id string) (Issue, error) {
	row := a.db.QueryRowContext(ctx, "SELECT "+issueColumns+" FROM webdev_issues WHERE issue_id = ?", id)
	return scanIssue(row)
}

func (a *Adapter) GetIssue(ctx context.Context, id string) (DataResult[Issue], error) {
	if invalidID(id) {
		return DataResult[Issue]{}, httperror.New(http.StatusNotFound, "issue_not_found", "Issue not found")
	}
	issue, err := a.getIssueRow(ctx, id)
	if err != nil {
		if err == sql.ErrNoRows {
			return DataResult[Issue]{}, httperror.New(http.StatusNotFound, "issue_not_found", "Issue not found")
		}
		return DataResult[Issue]{}, err
	}
	events, err := a.listIssueEvents(ctx, id)
	if err != nil {
		return DataResult[Issue]{}, err
	}
	issue.Events = events
	return DataResult[Issue]{Data: issue}, nil
}

func (a *Adapter) listIssueEvents(ctx context.Context, issueID string) ([]IssueEvent, error) {
	rows, err := a.db.QueryContext(ctx, `
		SELECT id, issue_id, actor, action, detail_json, created_at
		FROM webdev_issue_events
		WHERE issue_id = ?
		ORDER BY id ASC
		LIMIT 500
	`, issueID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := []IssueEvent{}
	for rows.Next() {
		var ev IssueEvent
		var detail sql.NullString
		if err := rows.Scan(&ev.ID, &ev.IssueID, &ev.Actor, &ev.Action, &detail, &ev.CreatedAt); err != nil {
			return nil, err
		}
		if detail.Valid && strings.TrimSpace(detail.String) != "" {
			ev.Detail = json.RawMessage(detail.String)
		}
		items = append(items, ev)
	}
	return items, rows.Err()
}

func (a *Adapter) CreateIssue(ctx context.Context, body map[string]any) (DataResult[Issue], error) {
	issueID := stringValue(body, "id")
	if issueID == "" {
		issueID = newID()
	}
	title := stringValue(body, "title")
	if title == "" {
		return DataResult[Issue]{}, httperror.New(http.StatusBadRequest, "missing_title", "Issue title is required")
	}
	tenant := stringValue(body, "tenant")
	createdAt := stringDefault(stringValue(body, "createdAt"), time.Now().UTC().Format(time.RFC3339Nano))

	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return DataResult[Issue]{}, err
	}
	defer func() { _ = tx.Rollback() }()

	// 租户内短号分配（FOR UPDATE 串行化同租户并发）
	var nextNo int64
	err = tx.QueryRowContext(ctx, "SELECT next_no FROM webdev_issue_counters WHERE tenant = ? FOR UPDATE", tenant).Scan(&nextNo)
	if err == sql.ErrNoRows {
		nextNo = 1
		if _, err = tx.ExecContext(ctx, "INSERT INTO webdev_issue_counters (tenant, next_no) VALUES (?, ?)", tenant, nextNo+1); err != nil {
			return DataResult[Issue]{}, err
		}
	} else if err != nil {
		return DataResult[Issue]{}, err
	} else if _, err = tx.ExecContext(ctx, "UPDATE webdev_issue_counters SET next_no = next_no + 1 WHERE tenant = ?", tenant); err != nil {
		return DataResult[Issue]{}, err
	}

	if _, err = tx.ExecContext(ctx, `
		INSERT INTO webdev_issues (
			issue_id, display_no, project_id, app_code, scope, page_key, page_url, repo_id, tenant,
			fingerprint, severity, kind, state, title, description, reporter_uid, reporter_name, assignee_uid,
			context_json, linked_job_id, claim_token, source, auto_claimed, claimed_at, created_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`,
		issueID, nextNo,
		stringDefault(stringValue(body, "projectId"), "huizhi-yun"),
		stringValue(body, "appCode"),
		stringDefault(stringValue(body, "scope"), "page"),
		stringValue(body, "pageKey"),
		stringValue(body, "pageUrl"),
		stringValue(body, "repoId"),
		tenant,
		stringValue(body, "fingerprint"),
		stringDefault(stringValue(body, "severity"), "mid"),
		stringDefault(stringValue(body, "kind"), "bug"),
		stringDefault(stringValue(body, "state"), "open"),
		title,
		stringValue(body, "description"),
		stringValue(body, "reporterUid"),
		stringValue(body, "reporterName"),
		stringValue(body, "assigneeUid"),
		jsonArg(body, "context"),
		stringValue(body, "linkedJobId"),
		stringValue(body, "claimToken"),
		stringDefault(stringValue(body, "source"), "manual"),
		boolToInt(body, "autoClaimed"),
		nullableStringArg(body, "claimedAt"),
		createdAt,
	); err != nil {
		return DataResult[Issue]{}, err
	}

	if _, err = tx.ExecContext(ctx, `
		INSERT INTO webdev_issue_events (tenant, issue_id, actor, action, created_at)
		VALUES (?, ?, ?, 'created', ?)
	`, tenant, issueID, stringDefault(stringValue(body, "reporterUid"), "system"), createdAt); err != nil {
		return DataResult[Issue]{}, err
	}

	if err = tx.Commit(); err != nil {
		return DataResult[Issue]{}, err
	}
	return a.GetIssue(ctx, issueID)
}

func (a *Adapter) UpdateIssue(ctx context.Context, id string, body map[string]any) (DataResult[Issue], error) {
	if invalidID(id) {
		return DataResult[Issue]{}, httperror.New(http.StatusNotFound, "issue_not_found", "Issue not found")
	}

	sets := []string{"updated_at = CURRENT_TIMESTAMP"}
	args := []any{}
	addStringPatch(body, "state", "state", &sets, &args)
	addStringPatch(body, "severity", "severity", &sets, &args)
	addStringPatch(body, "kind", "kind", &sets, &args)
	addStringPatch(body, "assigneeUid", "assignee_uid", &sets, &args)
	addStringPatch(body, "repoId", "repo_id", &sets, &args)
	addStringPatch(body, "linkedJobId", "linked_job_id", &sets, &args)
	addStringPatch(body, "claimToken", "claim_token", &sets, &args)
	addStringPatch(body, "claimedAt", "claimed_at", &sets, &args)
	if _, ok := body["autoClaimed"]; ok {
		sets = append(sets, "auto_claimed = ?")
		args = append(args, boolToInt(body, "autoClaimed"))
	}
	args = append(args, id)

	result, err := a.db.ExecContext(ctx, "UPDATE webdev_issues SET "+strings.Join(sets, ", ")+" WHERE issue_id = ?", args...)
	if err != nil {
		return DataResult[Issue]{}, err
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		return DataResult[Issue]{}, httperror.New(http.StatusNotFound, "issue_not_found", "Issue not found")
	}

	if state := stringValue(body, "state"); state != "" {
		actor := stringDefault(stringValue(body, "actor"), "system")
		detail, _ := json.Marshal(map[string]string{"state": state})
		_, _ = a.db.ExecContext(ctx, `
			INSERT INTO webdev_issue_events (tenant, issue_id, actor, action, detail_json, created_at)
			SELECT tenant, issue_id, ?, 'state_changed', ?, ? FROM webdev_issues WHERE issue_id = ?
		`, actor, string(detail), time.Now().UTC().Format(time.RFC3339Nano), id)
	}
	return a.GetIssue(ctx, id)
}

// ClaimIssue 原子抢占领取锁：仅当 Issue 处于 open 且未关联任务时成功（见设计 §8）。
func (a *Adapter) ClaimIssue(ctx context.Context, id string, body map[string]any) (DataResult[ClaimResult], error) {
	if invalidID(id) {
		return DataResult[ClaimResult]{}, httperror.New(http.StatusNotFound, "issue_not_found", "Issue not found")
	}
	claimToken := stringValue(body, "claimToken")
	actor := stringDefault(stringValue(body, "actor"), "system")
	now := time.Now().UTC().Format(time.RFC3339Nano)

	result, err := a.db.ExecContext(ctx, `
		UPDATE webdev_issues
		SET state = 'claiming', claim_token = ?, auto_claimed = ?, updated_at = CURRENT_TIMESTAMP
		WHERE issue_id = ? AND state = 'open' AND linked_job_id = ''
	`, claimToken, boolToInt(body, "autoClaimed"), id)
	if err != nil {
		return DataResult[ClaimResult]{}, err
	}
	affected, _ := result.RowsAffected()

	if affected == 1 {
		_, _ = a.db.ExecContext(ctx, `
			INSERT INTO webdev_issue_events (tenant, issue_id, actor, action, created_at)
			SELECT tenant, issue_id, ?, 'claimed', ? FROM webdev_issues WHERE issue_id = ?
		`, actor, now, id)
		issue, err := a.getIssueRow(ctx, id)
		if err != nil {
			return DataResult[ClaimResult]{}, err
		}
		return DataResult[ClaimResult]{Data: ClaimResult{Claimed: true, Issue: issue}}, nil
	}

	issue, err := a.getIssueRow(ctx, id)
	if err != nil {
		if err == sql.ErrNoRows {
			return DataResult[ClaimResult]{}, httperror.New(http.StatusNotFound, "issue_not_found", "Issue not found")
		}
		return DataResult[ClaimResult]{}, err
	}
	if issue.LinkedJobID != "" {
		return DataResult[ClaimResult]{Data: ClaimResult{Claimed: false, AlreadyLinked: true, Issue: issue}}, nil
	}
	return DataResult[ClaimResult]{}, httperror.New(http.StatusConflict, "issue_claim_conflict", "Issue is being claimed or not open")
}

func (a *Adapter) CreateIssueEvent(ctx context.Context, issueID string, body map[string]any) (DataResult[IssueEvent], error) {
	if invalidID(issueID) {
		return DataResult[IssueEvent]{}, httperror.New(http.StatusNotFound, "issue_not_found", "Issue not found")
	}
	action := stringValue(body, "action")
	if action == "" {
		return DataResult[IssueEvent]{}, httperror.New(http.StatusBadRequest, "missing_action", "Event action is required")
	}
	actor := stringDefault(stringValue(body, "actor"), "system")
	createdAt := stringDefault(stringValue(body, "createdAt"), time.Now().UTC().Format(time.RFC3339Nano))
	detailArg := jsonArg(body, "detail")

	result, err := a.db.ExecContext(ctx, `
		INSERT INTO webdev_issue_events (tenant, issue_id, actor, action, detail_json, created_at)
		SELECT tenant, issue_id, ?, ?, ?, ? FROM webdev_issues WHERE issue_id = ?
	`, actor, action, detailArg, createdAt, issueID)
	if err != nil {
		return DataResult[IssueEvent]{}, err
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		return DataResult[IssueEvent]{}, httperror.New(http.StatusNotFound, "issue_not_found", "Issue not found")
	}
	id, _ := result.LastInsertId()

	ev := IssueEvent{ID: id, IssueID: issueID, Actor: actor, Action: action, CreatedAt: createdAt}
	if s, ok := detailArg.(string); ok {
		ev.Detail = json.RawMessage(s)
	}
	return DataResult[IssueEvent]{Data: ev}, nil
}

func defaultIssueSettings(tenant string) IssueSettings {
	return IssueSettings{
		Tenant:           tenant,
		AutoClaimEnabled: true,
		SeverityMin:      "high",
		Kinds:            []string{"bug"},
		Apps:             []string{"finance", "workflow", "codocs"},
	}
}

func (a *Adapter) GetIssueSettings(ctx context.Context, tenant string) (DataResult[IssueSettings], error) {
	tenant = strings.TrimSpace(tenant)
	row := a.db.QueryRowContext(ctx, `
		SELECT auto_claim_enabled, severity_min, kinds_json, apps_json
		FROM webdev_issue_settings WHERE tenant = ?
	`, tenant)
	var enabled int64
	var severityMin string
	var kinds, apps sql.NullString
	if err := row.Scan(&enabled, &severityMin, &kinds, &apps); err != nil {
		if err == sql.ErrNoRows {
			return DataResult[IssueSettings]{Data: defaultIssueSettings(tenant)}, nil
		}
		return DataResult[IssueSettings]{}, err
	}
	return DataResult[IssueSettings]{Data: IssueSettings{
		Tenant:           tenant,
		AutoClaimEnabled: enabled != 0,
		SeverityMin:      stringDefault(severityMin, "high"),
		Kinds:            jsonToStringSlice(kinds),
		Apps:             jsonToStringSlice(apps),
	}}, nil
}

func (a *Adapter) UpdateIssueSettings(ctx context.Context, body map[string]any) (DataResult[IssueSettings], error) {
	tenant := stringValue(body, "tenant")
	severityMin := stringDefault(stringValue(body, "severityMin"), "high")
	kinds := bodyStringSlice(body, "kinds")
	apps := bodyStringSlice(body, "apps")
	kindsJSON, _ := json.Marshal(kinds)
	appsJSON, _ := json.Marshal(apps)

	if _, err := a.db.ExecContext(ctx, `
		INSERT INTO webdev_issue_settings (tenant, auto_claim_enabled, severity_min, kinds_json, apps_json)
		VALUES (?, ?, ?, ?, ?)
		ON DUPLICATE KEY UPDATE
			auto_claim_enabled = VALUES(auto_claim_enabled),
			severity_min = VALUES(severity_min),
			kinds_json = VALUES(kinds_json),
			apps_json = VALUES(apps_json),
			updated_at = CURRENT_TIMESTAMP
	`, tenant, boolToInt(body, "autoClaimEnabled"), severityMin, string(kindsJSON), string(appsJSON)); err != nil {
		return DataResult[IssueSettings]{}, err
	}
	return a.GetIssueSettings(ctx, tenant)
}

func jsonToStringSlice(value sql.NullString) []string {
	if !value.Valid || strings.TrimSpace(value.String) == "" {
		return []string{}
	}
	var out []string
	if err := json.Unmarshal([]byte(value.String), &out); err != nil {
		return []string{}
	}
	return out
}

func bodyStringSlice(body map[string]any, key string) []string {
	value, ok := body[key]
	if !ok || value == nil {
		return []string{}
	}
	switch typed := value.(type) {
	case []any:
		out := make([]string, 0, len(typed))
		for _, item := range typed {
			s := strings.TrimSpace(fmt.Sprint(item))
			if s != "" {
				out = append(out, s)
			}
		}
		return out
	case []string:
		return typed
	case string:
		return strings.FieldsFunc(typed, func(r rune) bool { return r == ',' || r == ' ' })
	}
	return []string{}
}

func jsonArg(body map[string]any, key string) any {
	value, ok := body[key]
	if !ok || value == nil {
		return nil
	}
	switch typed := value.(type) {
	case string:
		if strings.TrimSpace(typed) == "" {
			return nil
		}
		return typed
	default:
		encoded, err := json.Marshal(typed)
		if err != nil {
			return nil
		}
		return string(encoded)
	}
}

func boolToInt(body map[string]any, key string) int {
	switch typed := body[key].(type) {
	case bool:
		if typed {
			return 1
		}
	case float64:
		if typed != 0 {
			return 1
		}
	case string:
		if typed == "1" || strings.EqualFold(typed, "true") {
			return 1
		}
	}
	return 0
}

type jobScanner interface {
	Scan(dest ...any) error
}

func scanJob(row jobScanner) (Job, error) {
	var item Job
	var startedAt sql.NullString
	var finishedAt sql.NullString
	var exitCode sql.NullInt64
	if err := row.Scan(
		&item.ID,
		&item.ProjectID,
		&item.RepoID,
		&item.AgentID,
		&item.Type,
		&item.Status,
		&item.TemplateID,
		&item.Target,
		&item.Prompt,
		&item.CreatedBy,
		&item.CreatedAt,
		&startedAt,
		&finishedAt,
		&exitCode,
		&item.Error,
	); err != nil {
		return Job{}, err
	}
	item.StartedAt = nullableString(startedAt)
	item.FinishedAt = nullableString(finishedAt)
	if exitCode.Valid {
		value := int(exitCode.Int64)
		item.ExitCode = &value
	}
	return item, nil
}

func scanJobWithEventCount(row jobScanner) (Job, error) {
	var item Job
	var startedAt sql.NullString
	var finishedAt sql.NullString
	var exitCode sql.NullInt64
	var eventCount sql.NullInt64
	if err := row.Scan(
		&item.ID,
		&item.ProjectID,
		&item.RepoID,
		&item.AgentID,
		&item.Type,
		&item.Status,
		&item.TemplateID,
		&item.Target,
		&item.Prompt,
		&item.CreatedBy,
		&item.CreatedAt,
		&startedAt,
		&finishedAt,
		&exitCode,
		&item.Error,
		&eventCount,
	); err != nil {
		return Job{}, err
	}
	item.StartedAt = nullableString(startedAt)
	item.FinishedAt = nullableString(finishedAt)
	if exitCode.Valid {
		value := int(exitCode.Int64)
		item.ExitCode = &value
	}
	if eventCount.Valid {
		item.EventCount = eventCount.Int64
	}
	return item, nil
}

func addStringPatch(body map[string]any, jsonKey string, dbColumn string, sets *[]string, args *[]any) {
	value, exists := body[jsonKey]
	if !exists {
		return
	}
	*sets = append(*sets, dbColumn+" = ?")
	*args = append(*args, fmt.Sprint(value))
}

func stringValue(body map[string]any, key string) string {
	value, ok := body[key]
	if !ok || value == nil {
		return ""
	}
	return strings.TrimSpace(fmt.Sprint(value))
}

func stringDefault(value string, fallback string) string {
	if strings.TrimSpace(value) != "" {
		return strings.TrimSpace(value)
	}
	return fallback
}

func nullableStringArg(body map[string]any, key string) any {
	value := stringValue(body, key)
	if value == "" {
		return nil
	}
	return value
}

func intValue(body map[string]any, key string) (int, bool) {
	value, ok := body[key]
	if !ok || value == nil {
		return 0, false
	}
	switch typed := value.(type) {
	case float64:
		return int(typed), true
	case int:
		return typed, true
	case string:
		parsed, err := strconv.Atoi(strings.TrimSpace(typed))
		return parsed, err == nil
	default:
		parsed, err := strconv.Atoi(fmt.Sprint(value))
		return parsed, err == nil
	}
}

func int64Value(body map[string]any, key string) (int64, bool) {
	value, ok := intValue(body, key)
	return int64(value), ok
}

func parsePage(query url.Values) pageParams {
	page := parsePositiveInt(firstNonEmpty(query.Get("page"), "1"), 1)
	pageSize := parsePositiveInt(firstNonEmpty(query.Get("pageSize"), query.Get("page_size"), "20"), 20)
	page = clampInt(page, 1, 1000000)
	pageSize = clampInt(pageSize, 1, 100)
	return pageParams{
		page:     page,
		pageSize: pageSize,
		offset:   (page - 1) * pageSize,
	}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func parsePositiveInt(value string, fallback int) int {
	parsed, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil || parsed <= 0 {
		return fallback
	}
	return parsed
}

func clampInt(value int, min int, max int) int {
	if value < min {
		return min
	}
	if value > max {
		return max
	}
	return value
}

func nullableString(value sql.NullString) *string {
	if !value.Valid {
		return nil
	}
	return &value.String
}

func invalidID(value string) bool {
	return strings.TrimSpace(value) == "" || strings.Contains(value, "/")
}

func newID() string {
	var bytes [8]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(bytes[:])
}
