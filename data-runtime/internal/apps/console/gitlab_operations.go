package console

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

var gitLabRefPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._/-]{0,254}$`)
var gitLabSHApattern = regexp.MustCompile(`^[A-Fa-f0-9]{7,64}$`)
var gitLabIssueExternalKeyPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`)
var gitLabIssueDueDatePattern = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
var gitLabOperationClient = &http.Client{
	Timeout: 30 * time.Second,
	CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
		return http.ErrUseLastResponse
	},
}

type gitLabOperationRuntime struct {
	IntegrationCode string
	BaseURL         string
	Token           string
	DefaultBranch   string
}

func (a *Adapter) ExecuteServiceGitLabOperation(
	ctx context.Context,
	integrationCode string,
	operation string,
	body map[string]any,
	actorID string,
	appCode string,
	requestIP string,
	userAgent string,
) (any, error) {
	runtime, err := a.resolveServiceGitLabRuntime(
		ctx, integrationCode, "gitlab."+operation,
		actorID, appCode, requestIP, userAgent,
	)
	if err != nil {
		return nil, err
	}
	repoPath, err := normalizeGitLabRepoPath(body["repoPath"])
	if err != nil {
		return nil, err
	}
	switch operation {
	case "project-info":
		return runtime.projectInfo(ctx, repoPath)
	case "group-projects":
		return runtime.groupProjects(ctx, repoPath, body)
	case "commits":
		return runtime.commits(ctx, repoPath, body)
	case "commit-diff":
		return runtime.commitDiff(ctx, repoPath, body)
	case "markdown-tree":
		return runtime.markdownTree(ctx, repoPath, body)
	case "file":
		return runtime.file(ctx, repoPath, body)
	case "commit":
		return runtime.createCommit(ctx, repoPath, body)
	case "issue-upsert":
		return runtime.upsertIssue(ctx, repoPath, body)
	case "resolve-actions":
		return runtime.resolveActions(ctx, repoPath, body)
	default:
		return nil, httperror.New(
			http.StatusNotFound,
			"console_gitlab_operation_not_found",
			"GitLab operation was not found",
		)
	}
}

func (runtime gitLabOperationRuntime) groupProjects(
	ctx context.Context,
	groupPath string,
	body map[string]any,
) (map[string]any, error) {
	includeArchived := true
	if value, supplied := body["includeArchived"].(bool); supplied {
		includeArchived = value
	}
	type gitLabGroupProject struct {
		ID                int64  `json:"id"`
		Name              string `json:"name"`
		PathWithNamespace string `json:"path_with_namespace"`
		WebURL            string `json:"web_url"`
		Archived          bool   `json:"archived"`
		Namespace         struct {
			FullPath string `json:"full_path"`
		} `json:"namespace"`
	}

	items := make([]map[string]any, 0)
	seen := map[string]struct{}{}
	for page := 1; page <= 100; page++ {
		query := url.Values{
			"include_subgroups": {"false"},
			"with_shared":       {"false"},
			"order_by":          {"id"},
			"sort":              {"asc"},
			"per_page":          {"100"},
			"page":              {strconv.Itoa(page)},
		}
		if !includeArchived {
			query.Set("archived", "false")
		}
		var projects []gitLabGroupProject
		endpoint := "/api/v4/groups/" + url.PathEscape(groupPath) + "/projects?" + query.Encode()
		if err := runtime.requestJSON(ctx, http.MethodGet, endpoint, nil, &projects); err != nil {
			return nil, err
		}
		for _, project := range projects {
			code := strings.TrimSpace(project.PathWithNamespace)
			if project.ID <= 0 || code == "" || project.Namespace.FullPath != groupPath ||
				!strings.HasPrefix(code, groupPath+"/") {
				return nil, httperror.New(
					http.StatusBadGateway,
					"console_gitlab_response_invalid",
					"GitLab group project response is invalid",
				)
			}
			if _, duplicate := seen[code]; duplicate {
				continue
			}
			seen[code] = struct{}{}
			items = append(items, map[string]any{
				"id": project.ID, "projectCode": code, "parentId": groupPath,
				"name": project.Name, "repoUrl": project.WebURL, "archived": project.Archived,
				"isGroup": 0, "isTemplate": 0,
			})
		}
		if len(projects) < 100 {
			return map[string]any{"items": items, "total": len(items)}, nil
		}
	}
	return nil, httperror.New(
		http.StatusBadGateway,
		"console_gitlab_pagination_exceeded",
		"GitLab group project list exceeded the supported pagination bound",
	)
}

type gitLabIssueProjection struct {
	IID         int64  `json:"iid"`
	Title       string `json:"title"`
	Description string `json:"description"`
	State       string `json:"state"`
	WebURL      string `json:"web_url"`
}

func (runtime gitLabOperationRuntime) upsertIssue(
	ctx context.Context,
	repoPath string,
	body map[string]any,
) (map[string]any, error) {
	externalKey := strings.TrimSpace(integrationText(body["externalKey"]))
	title := strings.TrimSpace(integrationText(body["title"]))
	description := strings.TrimSpace(integrationText(body["description"]))
	state := strings.TrimSpace(integrationText(body["state"]))
	if !gitLabIssueExternalKeyPattern.MatchString(externalKey) || title == "" || len(title) > 255 || len(description) > 1024*1024 || (state != "opened" && state != "closed") {
		return nil, httperror.New(http.StatusBadRequest, "console_gitlab_issue_invalid", "GitLab issue input is invalid")
	}
	labels, err := normalizeGitLabIssueLabels(body["labels"])
	if err != nil {
		return nil, err
	}
	dueDate := strings.TrimSpace(integrationText(body["dueDate"]))
	if dueDate != "" && !gitLabIssueDueDatePattern.MatchString(dueDate) {
		return nil, httperror.New(http.StatusBadRequest, "console_gitlab_issue_due_date_invalid", "GitLab issue due date is invalid")
	}

	marker := "<!-- hzy-aims:item-key=" + externalKey + " -->"
	issueIID := int64(boundedGitLabInt(body["issueIid"], 0, 2147483647))
	var existing *gitLabIssueProjection
	if issueIID > 0 {
		issue, readErr := runtime.readIssue(ctx, repoPath, issueIID)
		if readErr != nil {
			if !isGitLabNotFound(readErr) {
				return nil, readErr
			}
		} else {
			if !strings.Contains(issue.Description, marker) {
				return nil, httperror.New(http.StatusConflict, "console_gitlab_issue_binding_conflict", "GitLab issue is bound to a different Aims work item")
			}
			existing = &issue
		}
	}
	if existing == nil {
		issues, searchErr := runtime.searchIssues(ctx, repoPath, externalKey)
		if searchErr != nil {
			return nil, searchErr
		}
		for index := range issues {
			if strings.Contains(issues[index].Description, marker) {
				existing = &issues[index]
				break
			}
		}
	}

	fullDescription := description
	if fullDescription != "" {
		fullDescription += "\n\n"
	}
	fullDescription += marker
	payload := map[string]any{
		"title": title, "description": fullDescription, "labels": labels,
	}
	if dueDate != "" {
		payload["due_date"] = dueDate
	}
	created := existing == nil
	method := http.MethodPost
	endpoint := "/api/v4/projects/" + url.PathEscape(repoPath) + "/issues"
	if existing != nil {
		method = http.MethodPut
		endpoint += "/" + strconv.FormatInt(existing.IID, 10)
		if dueDate == "" {
			payload["due_date"] = nil
		}
		if state == "closed" {
			payload["state_event"] = "close"
		} else {
			payload["state_event"] = "reopen"
		}
	}
	var issue gitLabIssueProjection
	if err := runtime.requestJSON(ctx, method, endpoint, payload, &issue); err != nil {
		return nil, err
	}
	if issue.IID <= 0 || strings.TrimSpace(issue.WebURL) == "" {
		return nil, httperror.New(http.StatusBadGateway, "console_gitlab_response_invalid", "GitLab issue response is invalid")
	}
	return map[string]any{
		"iid": issue.IID, "webUrl": issue.WebURL, "state": issue.State, "created": created,
	}, nil
}

func (runtime gitLabOperationRuntime) readIssue(ctx context.Context, repoPath string, issueIID int64) (gitLabIssueProjection, error) {
	var issue gitLabIssueProjection
	endpoint := "/api/v4/projects/" + url.PathEscape(repoPath) + "/issues/" + strconv.FormatInt(issueIID, 10)
	err := runtime.requestJSON(ctx, http.MethodGet, endpoint, nil, &issue)
	return issue, err
}

func (runtime gitLabOperationRuntime) searchIssues(ctx context.Context, repoPath, externalKey string) ([]gitLabIssueProjection, error) {
	query := url.Values{"scope": {"all"}, "state": {"all"}, "search": {externalKey}, "per_page": {"100"}}
	var issues []gitLabIssueProjection
	endpoint := "/api/v4/projects/" + url.PathEscape(repoPath) + "/issues?" + query.Encode()
	if err := runtime.requestJSON(ctx, http.MethodGet, endpoint, nil, &issues); err != nil {
		return nil, err
	}
	return issues, nil
}

func normalizeGitLabIssueLabels(value any) ([]string, error) {
	raw, ok := value.([]any)
	if !ok && value != nil {
		return nil, httperror.New(http.StatusBadRequest, "console_gitlab_issue_labels_invalid", "GitLab issue labels are invalid")
	}
	if len(raw) > 20 {
		return nil, httperror.New(http.StatusBadRequest, "console_gitlab_issue_labels_invalid", "GitLab issue labels are invalid")
	}
	labels := make([]string, 0, len(raw))
	seen := map[string]struct{}{}
	for _, item := range raw {
		label := strings.TrimSpace(integrationText(item))
		if label == "" || len(label) > 255 || strings.ContainsAny(label, "\r\n,") {
			return nil, httperror.New(http.StatusBadRequest, "console_gitlab_issue_labels_invalid", "GitLab issue labels are invalid")
		}
		if _, exists := seen[label]; exists {
			continue
		}
		seen[label] = struct{}{}
		labels = append(labels, label)
	}
	return labels, nil
}

func (a *Adapter) resolveServiceGitLabRuntime(
	ctx context.Context,
	integrationCode string,
	operation string,
	actorID string,
	appCode string,
	requestIP string,
	userAgent string,
) (gitLabOperationRuntime, error) {
	code, err := a.requireAuthorizedIntegrationOperation(
		ctx, integrationCode, operation, actorID, appCode,
	)
	if err != nil {
		return gitLabOperationRuntime{}, err
	}
	row, err := scanIntegrationProjection(a.db.QueryRowContext(
		ctx,
		integrationProjectionSelect+" WHERE i.integration_code=? LIMIT 1",
		code,
	))
	if errors.Is(err, sql.ErrNoRows) {
		return gitLabOperationRuntime{}, httperror.New(
			http.StatusNotFound,
			"console_integration_not_found",
			"Integration was not found",
		)
	}
	if err != nil {
		return gitLabOperationRuntime{}, err
	}
	if row.Status != "active" || row.IntegrationType != "gitlab" ||
		!row.SecretCode.Valid || !row.SecretVersionNo.Valid {
		return gitLabOperationRuntime{}, httperror.New(
			http.StatusServiceUnavailable,
			"console_gitlab_integration_unavailable",
			"GitLab integration is unavailable",
		)
	}
	baseURL, err := safeIntegrationBaseURL(row.BaseURL.String)
	if err != nil {
		return gitLabOperationRuntime{}, httperror.New(
			http.StatusServiceUnavailable,
			"console_gitlab_integration_invalid",
			"GitLab integration URL is invalid",
		)
	}
	secret, err := queryVaultSecret(ctx, a.db, row.SecretCode.String, row.SecretVersionNo.Int64, false)
	if err != nil {
		return gitLabOperationRuntime{}, err
	}
	meta := VaultAccessMeta{
		ActorType: "service",
		ActorID:   actorID,
		AppCode:   appCode,
		RequestIP: requestIP,
		UserAgent: userAgent,
		Reason:    "gitlab_fixed_operation:" + code,
	}
	if secret.UsageType != "integration" || secret.OwnerType != "integration" ||
		!secret.OwnerKey.Valid || secret.OwnerKey.String != code {
		_ = insertVaultAccessLog(
			ctx, a.db, int64(secret.ID), secret.VersionID.Int64, "resolve", meta, "denied",
		)
		return gitLabOperationRuntime{}, httperror.New(
			http.StatusForbidden,
			"console_gitlab_credential_binding_invalid",
			"GitLab credential binding is invalid",
		)
	}
	token, resolveErr := a.resolveVaultMaterial(
		secret.StorageBackend,
		secret.CiphertextBlob,
		secret.BackendSecretRef.String,
		secret.ContentHash.String,
	)
	status := "success"
	if resolveErr != nil {
		status = "failed"
	}
	logErr := insertVaultAccessLog(
		ctx, a.db, int64(secret.ID), secret.VersionID.Int64, "resolve", meta, status,
	)
	if resolveErr != nil {
		return gitLabOperationRuntime{}, httperror.New(
			http.StatusServiceUnavailable,
			"console_gitlab_credential_unavailable",
			"GitLab credential is unavailable",
		)
	}
	if logErr != nil {
		return gitLabOperationRuntime{}, logErr
	}
	config := map[string]any{}
	if len(row.ConfigJSON) > 0 {
		_ = json.Unmarshal(row.ConfigJSON, &config)
	}
	defaultBranch := normalizeGitLabOptionalRef(integrationConfigText(config, "defaultBranch"))
	return gitLabOperationRuntime{
		IntegrationCode: code,
		BaseURL:         baseURL,
		Token:           token,
		DefaultBranch:   defaultBranch,
	}, nil
}

func (runtime gitLabOperationRuntime) projectInfo(ctx context.Context, repoPath string) (map[string]any, error) {
	var project struct {
		ID                int64  `json:"id"`
		DefaultBranch     string `json:"default_branch"`
		PathWithNamespace string `json:"path_with_namespace"`
	}
	if err := runtime.requestJSON(
		ctx, http.MethodGet, "/api/v4/projects/"+url.PathEscape(repoPath), nil, &project,
	); err != nil {
		return nil, err
	}
	return map[string]any{
		"id":                  project.ID,
		"default_branch":      project.DefaultBranch,
		"path_with_namespace": project.PathWithNamespace,
	}, nil
}

func (runtime gitLabOperationRuntime) defaultBranch(ctx context.Context, repoPath string) string {
	if runtime.DefaultBranch != "" {
		return runtime.DefaultBranch
	}
	project, err := runtime.projectInfo(ctx, repoPath)
	if err == nil {
		if branch := strings.TrimSpace(fmt.Sprint(project["default_branch"])); branch != "" {
			return branch
		}
	}
	return "main"
}

func (runtime gitLabOperationRuntime) commits(
	ctx context.Context,
	repoPath string,
	body map[string]any,
) ([]map[string]any, error) {
	query := url.Values{
		"page":       {strconv.Itoa(boundedGitLabInt(body["page"], 1, 10000))},
		"per_page":   {strconv.Itoa(boundedGitLabInt(body["perPage"], 50, 100))},
		"with_stats": {"true"},
	}
	for key, bodyKey := range map[string]string{
		"ref_name": "ref", "path": "path", "since": "since", "until": "until",
	} {
		if value := strings.TrimSpace(integrationText(body[bodyKey])); value != "" {
			if len(value) > 512 || strings.ContainsAny(value, "\r\n") {
				return nil, httperror.New(
					http.StatusBadRequest,
					"console_gitlab_query_invalid",
					"GitLab query is invalid",
				)
			}
			query.Set(key, value)
		}
	}
	var commits []struct {
		ID            string `json:"id"`
		ShortID       string `json:"short_id"`
		Title         string `json:"title"`
		Message       string `json:"message"`
		AuthorName    string `json:"author_name"`
		AuthorEmail   string `json:"author_email"`
		AuthoredDate  string `json:"authored_date"`
		CommittedDate string `json:"committed_date"`
		WebURL        string `json:"web_url"`
		Stats         *struct {
			Additions int `json:"additions"`
			Deletions int `json:"deletions"`
			Total     int `json:"total"`
		} `json:"stats"`
	}
	endpoint := "/api/v4/projects/" + url.PathEscape(repoPath) +
		"/repository/commits?" + query.Encode()
	if err := runtime.requestJSON(ctx, http.MethodGet, endpoint, nil, &commits); err != nil {
		return nil, err
	}
	result := make([]map[string]any, 0, len(commits))
	for _, commit := range commits {
		item := map[string]any{
			"sha":           commit.ID,
			"shortSha":      commit.ShortID,
			"title":         commit.Title,
			"message":       commit.Message,
			"authorName":    commit.AuthorName,
			"authorEmail":   commit.AuthorEmail,
			"authoredDate":  commit.AuthoredDate,
			"committedDate": commit.CommittedDate,
			"webUrl":        commit.WebURL,
			"additions":     nil,
			"deletions":     nil,
			"total":         nil,
		}
		if commit.Stats != nil {
			item["additions"] = commit.Stats.Additions
			item["deletions"] = commit.Stats.Deletions
			item["total"] = commit.Stats.Total
		}
		result = append(result, item)
	}
	return result, nil
}

func (runtime gitLabOperationRuntime) commitDiff(
	ctx context.Context,
	repoPath string,
	body map[string]any,
) ([]map[string]any, error) {
	sha := strings.TrimSpace(integrationText(body["sha"]))
	if !gitLabSHApattern.MatchString(sha) {
		return nil, httperror.New(
			http.StatusBadRequest,
			"console_gitlab_sha_invalid",
			"GitLab commit SHA is invalid",
		)
	}
	var diffs []struct {
		OldPath     string `json:"old_path"`
		NewPath     string `json:"new_path"`
		NewFile     bool   `json:"new_file"`
		RenamedFile bool   `json:"renamed_file"`
		DeletedFile bool   `json:"deleted_file"`
		Diff        string `json:"diff"`
	}
	endpoint := "/api/v4/projects/" + url.PathEscape(repoPath) +
		"/repository/commits/" + url.PathEscape(sha) + "/diff"
	if err := runtime.requestJSON(ctx, http.MethodGet, endpoint, nil, &diffs); err != nil {
		return nil, err
	}
	result := make([]map[string]any, 0, len(diffs))
	for _, diff := range diffs {
		result = append(result, map[string]any{
			"oldPath": diff.OldPath, "newPath": diff.NewPath,
			"newFile": diff.NewFile, "renamedFile": diff.RenamedFile,
			"deletedFile": diff.DeletedFile, "diff": diff.Diff,
		})
	}
	return result, nil
}

func (runtime gitLabOperationRuntime) markdownTree(
	ctx context.Context,
	repoPath string,
	body map[string]any,
) (map[string]any, error) {
	ref := normalizeGitLabOptionalRef(integrationText(body["ref"]))
	defaultBranch := runtime.defaultBranch(ctx, repoPath)
	if ref == "" {
		ref = defaultBranch
	}
	headCommitID := ""
	commits, err := runtime.commits(ctx, repoPath, map[string]any{
		"ref": ref, "page": 1, "perPage": 1,
	})
	if err == nil && len(commits) > 0 {
		headCommitID = strings.TrimSpace(fmt.Sprint(commits[0]["sha"]))
	}
	type treeItem struct {
		ID   string `json:"id"`
		Name string `json:"name"`
		Type string `json:"type"`
		Path string `json:"path"`
	}
	readTree := func(path string, recursive bool) ([]treeItem, error) {
		result := make([]treeItem, 0)
		for page := 1; page <= 100; page++ {
			query := url.Values{
				"recursive": {strconv.FormatBool(recursive)}, "per_page": {"100"},
				"ref": {ref}, "page": {strconv.Itoa(page)},
			}
			if path != "" {
				query.Set("path", path)
			}
			var items []treeItem
			endpoint := "/api/v4/projects/" + url.PathEscape(repoPath) +
				"/repository/tree?" + query.Encode()
			if err := runtime.requestJSON(ctx, http.MethodGet, endpoint, nil, &items); err != nil {
				return nil, err
			}
			result = append(result, items...)
			if len(items) < 100 {
				break
			}
		}
		return result, nil
	}

	allFiles, err := readTree("", false)
	if err != nil {
		return nil, err
	}
	docsFiles, err := readTree("docs", true)
	if err != nil && !isGitLabNotFound(err) {
		return nil, err
	}
	if err == nil {
		allFiles = append(allFiles, docsFiles...)
	}
	files := make([]map[string]any, 0)
	for _, file := range allFiles {
		if file.Type == "blob" && isGitLabMarkdownPath(file.Path) {
			files = append(files, map[string]any{
				"path": file.Path, "name": file.Name, "blob_id": file.ID,
			})
		}
	}
	sort.Slice(files, func(i, j int) bool {
		return fmt.Sprint(files[i]["path"]) < fmt.Sprint(files[j]["path"])
	})
	return map[string]any{
		"files": files, "ref": ref, "default_branch": defaultBranch,
		"head_commit_id": headCommitID, "repo_path": repoPath,
	}, nil
}

func (runtime gitLabOperationRuntime) file(
	ctx context.Context,
	repoPath string,
	body map[string]any,
) (map[string]any, error) {
	filePath, err := normalizeGitLabFilePath(body["path"])
	if err != nil {
		return nil, err
	}
	ref := normalizeGitLabOptionalRef(firstIntegrationText(
		integrationText(body["commitId"]), integrationText(body["ref"]),
	))
	if ref == "" {
		ref = runtime.defaultBranch(ctx, repoPath)
	}
	var file struct {
		FileName     string `json:"file_name"`
		FilePath     string `json:"file_path"`
		Size         int64  `json:"size"`
		Encoding     string `json:"encoding"`
		Content      string `json:"content"`
		Ref          string `json:"ref"`
		BlobID       string `json:"blob_id"`
		CommitID     string `json:"commit_id"`
		LastCommitID string `json:"last_commit_id"`
	}
	endpoint := "/api/v4/projects/" + url.PathEscape(repoPath) +
		"/repository/files/" + url.PathEscape(filePath) +
		"?ref=" + url.QueryEscape(ref)
	if err := runtime.requestJSON(ctx, http.MethodGet, endpoint, nil, &file); err != nil {
		return nil, err
	}
	content := file.Content
	if file.Encoding == "base64" {
		decoded, decodeErr := decodeGitLabBase64(file.Content)
		if decodeErr != nil {
			return nil, httperror.New(
				http.StatusBadGateway,
				"console_gitlab_response_invalid",
				"GitLab file response is invalid",
			)
		}
		content = string(decoded)
	}
	return map[string]any{
		"path": file.FilePath, "name": file.FileName, "size": file.Size,
		"encoding": file.Encoding, "content": content, "ref": file.Ref,
		"blobId": file.BlobID, "commitId": file.CommitID,
		"lastCommitId": file.LastCommitID,
	}, nil
}

func (runtime gitLabOperationRuntime) createCommit(
	ctx context.Context,
	repoPath string,
	body map[string]any,
) (map[string]any, error) {
	branch := normalizeGitLabOptionalRef(integrationText(body["branch"]))
	if branch == "" {
		branch = runtime.defaultBranch(ctx, repoPath)
	}
	message := strings.TrimSpace(integrationText(body["commitMessage"]))
	if message == "" || len(message) > 5000 {
		return nil, httperror.New(
			http.StatusBadRequest,
			"console_gitlab_commit_message_invalid",
			"GitLab commit message is invalid",
		)
	}
	actions, err := normalizeGitLabActions(body["actions"])
	if err != nil {
		return nil, err
	}
	payload := map[string]any{
		"branch": branch, "commit_message": message, "actions": actions,
	}
	if authorName := strings.TrimSpace(integrationText(body["authorName"])); authorName != "" {
		payload["author_name"] = authorName
	}
	if authorEmail := strings.TrimSpace(integrationText(body["authorEmail"])); authorEmail != "" {
		payload["author_email"] = authorEmail
	}
	var commit struct {
		ID      string `json:"id"`
		ShortID string `json:"short_id"`
		WebURL  string `json:"web_url"`
	}
	endpoint := "/api/v4/projects/" + url.PathEscape(repoPath) + "/repository/commits"
	if err := runtime.requestJSON(ctx, http.MethodPost, endpoint, payload, &commit); err != nil {
		return nil, err
	}
	if commit.ID == "" && commit.ShortID == "" {
		return nil, httperror.New(
			http.StatusBadGateway,
			"console_gitlab_response_invalid",
			"GitLab commit response is invalid",
		)
	}
	revision := commit.ShortID
	if revision == "" {
		revision = commit.ID
	}
	return map[string]any{
		"revision": revision, "commitId": commit.ID,
		"webUrl": commit.WebURL, "repoPath": repoPath, "branch": branch,
	}, nil
}

func (runtime gitLabOperationRuntime) resolveActions(
	ctx context.Context,
	repoPath string,
	body map[string]any,
) (map[string]any, error) {
	branch := normalizeGitLabOptionalRef(integrationText(body["branch"]))
	if branch == "" {
		branch = runtime.defaultBranch(ctx, repoPath)
	}
	rawDocs, ok := body["docs"].([]any)
	if !ok || len(rawDocs) == 0 || len(rawDocs) > 100 {
		return nil, httperror.New(
			http.StatusBadRequest,
			"console_gitlab_docs_invalid",
			"GitLab documents are invalid",
		)
	}
	actions := make([]map[string]any, 0, len(rawDocs))
	totalContent := 0
	for _, raw := range rawDocs {
		doc, _ := raw.(map[string]any)
		filePath, err := normalizeGitLabFilePath(doc["gitlabPath"])
		if err != nil {
			return nil, err
		}
		content := integrationText(doc["content"])
		totalContent += len(content)
		if totalContent > 5*1024*1024 {
			return nil, httperror.New(
				http.StatusRequestEntityTooLarge,
				"console_gitlab_payload_too_large",
				"GitLab documents payload is too large",
			)
		}
		action := "create"
		endpoint := "/api/v4/projects/" + url.PathEscape(repoPath) +
			"/repository/files/" + url.PathEscape(filePath) +
			"?ref=" + url.QueryEscape(branch)
		var ignored map[string]any
		requestErr := runtime.requestJSON(ctx, http.MethodGet, endpoint, nil, &ignored)
		if requestErr == nil {
			action = "update"
		} else if !isGitLabNotFound(requestErr) {
			return nil, requestErr
		}
		actions = append(actions, map[string]any{
			"action": action, "file_path": filePath,
			"content": content, "encoding": "text",
		})
	}
	return map[string]any{
		"repoPath": repoPath, "branch": branch, "actions": actions,
	}, nil
}

func (runtime gitLabOperationRuntime) requestJSON(
	ctx context.Context,
	method string,
	requestPath string,
	body any,
	target any,
) error {
	if !strings.HasPrefix(requestPath, "/api/v4/") || strings.Contains(requestPath, `\`) {
		return httperror.New(
			http.StatusBadRequest,
			"console_gitlab_operation_invalid",
			"GitLab operation is invalid",
		)
	}
	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return err
		}
		if len(encoded) > 8*1024*1024 {
			return httperror.New(
				http.StatusRequestEntityTooLarge,
				"console_gitlab_payload_too_large",
				"GitLab operation payload is too large",
			)
		}
		reader = bytes.NewReader(encoded)
	}
	request, err := http.NewRequestWithContext(ctx, method, runtime.BaseURL+requestPath, reader)
	if err != nil {
		return err
	}
	request.Header.Set("PRIVATE-TOKEN", runtime.Token)
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	response, err := gitLabOperationClient.Do(request)
	if err != nil {
		return httperror.New(
			http.StatusBadGateway,
			"console_gitlab_unavailable",
			"GitLab is unavailable",
		)
	}
	defer response.Body.Close()
	responseBody, readErr := io.ReadAll(io.LimitReader(response.Body, 10*1024*1024+1))
	if readErr != nil {
		return httperror.New(
			http.StatusBadGateway,
			"console_gitlab_response_invalid",
			"GitLab response could not be read",
		)
	}
	if len(responseBody) > 10*1024*1024 {
		return httperror.New(
			http.StatusBadGateway,
			"console_gitlab_response_too_large",
			"GitLab response exceeded the size limit",
		)
	}
	if response.StatusCode == http.StatusNotFound {
		return httperror.New(
			http.StatusNotFound,
			"console_gitlab_not_found",
			"GitLab resource was not found",
		)
	}
	if response.StatusCode/100 != 2 {
		return httperror.New(
			http.StatusBadGateway,
			"console_gitlab_request_failed",
			"GitLab rejected the fixed operation",
		)
	}
	if target != nil && json.Unmarshal(responseBody, target) != nil {
		return httperror.New(
			http.StatusBadGateway,
			"console_gitlab_response_invalid",
			"GitLab response is invalid",
		)
	}
	return nil
}

func normalizeGitLabRepoPath(value any) (string, error) {
	repoPath := strings.TrimSuffix(
		strings.Trim(strings.TrimSpace(integrationText(value)), "/"),
		".git",
	)
	if len(repoPath) < 3 || len(repoPath) > 300 ||
		strings.Contains(repoPath, "://") || strings.Contains(repoPath, `\`) ||
		strings.ContainsAny(repoPath, "\r\n?#") {
		return "", httperror.New(
			http.StatusBadRequest,
			"console_gitlab_repo_path_invalid",
			"GitLab repository path is invalid",
		)
	}
	for _, segment := range strings.Split(repoPath, "/") {
		if segment == "" || segment == "." || segment == ".." {
			return "", httperror.New(
				http.StatusBadRequest,
				"console_gitlab_repo_path_invalid",
				"GitLab repository path is invalid",
			)
		}
	}
	return repoPath, nil
}

func normalizeGitLabFilePath(value any) (string, error) {
	filePath := strings.Trim(strings.TrimSpace(integrationText(value)), "/")
	if filePath == "" || len(filePath) > 500 || strings.Contains(filePath, `\`) ||
		strings.ContainsAny(filePath, "\r\n?#") {
		return "", httperror.New(
			http.StatusBadRequest,
			"console_gitlab_file_path_invalid",
			"GitLab file path is invalid",
		)
	}
	for _, segment := range strings.Split(filePath, "/") {
		if segment == "" || segment == "." || segment == ".." {
			return "", httperror.New(
				http.StatusBadRequest,
				"console_gitlab_file_path_invalid",
				"GitLab file path is invalid",
			)
		}
	}
	return filePath, nil
}

func normalizeGitLabOptionalRef(value string) string {
	ref := strings.TrimSpace(value)
	if ref != "" && gitLabRefPattern.MatchString(ref) &&
		!strings.Contains(ref, "..") && !strings.Contains(ref, "//") {
		return ref
	}
	return ""
}

func normalizeGitLabActions(value any) ([]map[string]any, error) {
	rawActions, ok := value.([]any)
	if !ok || len(rawActions) == 0 || len(rawActions) > 100 {
		return nil, httperror.New(
			http.StatusBadRequest,
			"console_gitlab_actions_invalid",
			"GitLab commit actions are invalid",
		)
	}
	allowed := map[string]bool{
		"create": true, "update": true, "delete": true,
		"move": true, "chmod": true,
	}
	totalContent := 0
	actions := make([]map[string]any, 0, len(rawActions))
	for _, raw := range rawActions {
		action, _ := raw.(map[string]any)
		actionName := strings.TrimSpace(integrationText(action["action"]))
		filePath, err := normalizeGitLabFilePath(action["file_path"])
		if err != nil || !allowed[actionName] {
			return nil, httperror.New(
				http.StatusBadRequest,
				"console_gitlab_actions_invalid",
				"GitLab commit actions are invalid",
			)
		}
		normalized := map[string]any{"action": actionName, "file_path": filePath}
		for _, field := range []string{"content", "previous_path", "encoding"} {
			if value := integrationText(action[field]); value != "" {
				normalized[field] = value
				if field == "content" {
					totalContent += len(value)
				}
			}
		}
		actions = append(actions, normalized)
	}
	if totalContent > 5*1024*1024 {
		return nil, httperror.New(
			http.StatusRequestEntityTooLarge,
			"console_gitlab_payload_too_large",
			"GitLab commit payload is too large",
		)
	}
	return actions, nil
}

func boundedGitLabInt(value any, fallback int, maximum int) int {
	parsed, err := strconv.Atoi(strings.TrimSpace(integrationText(value)))
	if err != nil || parsed <= 0 {
		return fallback
	}
	if parsed > maximum {
		return maximum
	}
	return parsed
}

func isGitLabMarkdownPath(value string) bool {
	lower := strings.ToLower(value)
	return strings.HasSuffix(lower, ".md") &&
		(!strings.Contains(value, "/") || strings.HasPrefix(lower, "docs/"))
}

func decodeGitLabBase64(value string) ([]byte, error) {
	return base64.StdEncoding.DecodeString(strings.ReplaceAll(value, "\n", ""))
}

func isGitLabNotFound(err error) bool {
	var httpErr httperror.Error
	return errors.As(err, &httpErr) && httpErr.Status == http.StatusNotFound
}
