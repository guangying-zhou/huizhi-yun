package server

import (
	"context"
	codocsapp "github.com/huizhi-yun/data-runtime/internal/apps/codocs"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"net/http"
	"strings"
)

type enterpriseProjectRepositoryRead struct {
	Operation string `json:"operation"`
	Path      string `json:"path,omitempty"`
	Ref       string `json:"ref,omitempty"`
	CommitID  string `json:"commitId,omitempty"`
}

func (s *Server) routeEnterpriseProjectRepositoryRead(r *http.Request) (routeResult, error) {
	return s.projectDocumentContext(r, false, true)
}

func validProjectRepositoryReadInput(in enterpriseProjectDocumentContextInput) bool {
	p := in.RepositoryRead
	if p == nil || in.AccessAction != "" || in.DocumentUUID != "" || !validEnterpriseRepositoryPath(in.RepoProjectCode) {
		return false
	}
	if p.Operation == "markdown-tree" {
		return in.DocumentID == "" && p.Path == "" && p.CommitID == ""
	}
	return p.Operation == "file" && p.Path != "" && len(p.Path) <= 400 && !strings.ContainsAny(p.Path, "\\?\x00") && !strings.HasPrefix(p.Path, "/") && !strings.Contains(p.Path, "..")
}

func (s *Server) readProjectRepositoryDocument(ctx context.Context, in enterpriseProjectDocumentContextInput, facts map[string]any, actor string, depts []string) (map[string]any, error) {
	if s.console == nil {
		return nil, httperror.New(503, "project_repository_reader_unavailable", "Repository reader unavailable")
	}
	p := in.RepositoryRead
	check := func(f map[string]any) error {
		if f["isMember"] != true {
			return httperror.New(403, "project_repository_denied", "Project membership is required")
		}
		if in.DocumentID == "" {
			return nil
		}
		if !projectRepositoryDocumentMatches(f, in) {
			return httperror.New(403, "project_repository_document_mismatch", "Repository document binding mismatch")
		}
		if s.codocs == nil {
			return httperror.New(503, "project_document_dependency_unavailable", "Document access unavailable")
		}
		code, _ := f["projectCode"].(string)
		uuid, _ := f["documentUuid"].(string)
		projects, _ := f["actorProjectCodes"].([]string)
		roles, _ := f["actorRoles"].([]string)
		acl, err := s.codocs.CheckEnterpriseRepositoryProjectDocument(ctx, uuid, "view", codocsapp.EnterpriseProjectDocumentFacts{ActorUID: actor, ProjectCode: code, ProjectCodes: projects, DeptCodes: depts, Roles: roles})
		if err != nil {
			return err
		}
		if acl["allowed"] != true {
			return httperror.New(403, "project_document_access_denied", "Document access denied")
		}
		return nil
	}
	if err := check(facts); err != nil {
		return nil, err
	}
	file, err := s.console.ReadEnterpriseAimsRepository(ctx, p.Operation, in.RepoProjectCode, p.Path, p.Ref, p.CommitID, actor)
	if err != nil {
		return nil, err
	}
	if p.Operation == "file" && (file["path"] != p.Path || (p.CommitID != "" && file["commitId"] != p.CommitID)) {
		return nil, httperror.New(503, "project_repository_version_invalid", "Repository version response invalid")
	}
	out := file
	if p.Operation == "file" {
		latest := file
		if p.CommitID != "" {
			latest, err = s.console.ReadEnterpriseAimsRepository(ctx, "file", in.RepoProjectCode, p.Path, "", "", actor)
			if err != nil {
				return nil, err
			}
		}
		// Latest bytes are never released when previewing a frozen version.
		out = map[string]any{"file": file, "latest": map[string]any{"path": latest["path"], "commitId": latest["commitId"], "lastCommitId": latest["lastCommitId"], "blobId": latest["blobId"]}}
	}
	current, err := s.aims.EnterpriseProjectDocumentContext(ctx, in.ProjectID, in.DocumentID, in.RepoProjectCode, actor, in.ProjectAdmin, depts)
	if err != nil {
		return nil, err
	}
	if err = check(current); err != nil {
		return nil, err
	}
	return out, nil
}

// The owning generic document read projects SQL column names; newer callers may
// supply normalized names. Accept only these exact aliases and reject disagreement.
func projectRepositoryDocumentMatches(f map[string]any, in enterpriseProjectDocumentContextInput) bool {
	d, _ := f["document"].(map[string]any)
	text := func(key, column string) string {
		v, _ := d[key].(string)
		stored, _ := d[column].(string)
		if v != "" && stored != "" && v != stored {
			return ""
		}
		if v != "" {
			return v
		}
		return stored
	}
	p := in.RepositoryRead
	return p != nil && f["repositoryReference"] == true &&
		text("repoProjectCode", "repo_project_code") == in.RepoProjectCode &&
		text("repoFilePath", "repo_file_path") == p.Path &&
		text("repoCommitId", "repo_commit_id") != "" &&
		text("repoCommitId", "repo_commit_id") == p.CommitID
}
