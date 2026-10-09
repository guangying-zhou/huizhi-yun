package server

import "testing"

func TestProjectRepositoryReadInputClosed(t *testing.T) {
	base := func() enterpriseProjectDocumentContextInput {
		return enterpriseProjectDocumentContextInput{RepoProjectCode: "group/repo", RepositoryRead: &enterpriseProjectRepositoryRead{Operation: "file", Path: "docs/spec.md", CommitID: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}}
	}
	if !validProjectRepositoryReadInput(base()) {
		t.Fatal("valid read")
	}
	for _, change := range []func(*enterpriseProjectDocumentContextInput){
		func(i *enterpriseProjectDocumentContextInput) { i.RepositoryRead.Operation = "issue-upsert" },
		func(i *enterpriseProjectDocumentContextInput) { i.RepositoryRead.Path = "../secret" },
		func(i *enterpriseProjectDocumentContextInput) { i.RepositoryRead.Path = "/etc/passwd" },
		func(i *enterpriseProjectDocumentContextInput) { i.RepoProjectCode = "other/../repo" },
		func(i *enterpriseProjectDocumentContextInput) { i.DocumentUUID = "forged" },
		func(i *enterpriseProjectDocumentContextInput) { i.AccessAction = "edit" },
		func(i *enterpriseProjectDocumentContextInput) {
			i.RepositoryRead.Operation = "markdown-tree"
			i.DocumentID = "45"
			i.RepositoryRead.Path = ""
			i.RepositoryRead.CommitID = ""
		},
	} {
		i := base()
		change(&i)
		if validProjectRepositoryReadInput(i) {
			t.Fatalf("invalid input accepted: %#v", i)
		}
	}
	tree := base()
	tree.RepositoryRead = &enterpriseProjectRepositoryRead{Operation: "markdown-tree", Ref: "main"}
	if !validProjectRepositoryReadInput(tree) {
		t.Fatal("valid tree")
	}
}

func TestProjectRepositoryReadRawOwningDocumentBinding(t *testing.T) {
	in := enterpriseProjectDocumentContextInput{RepoProjectCode: "group/repo", RepositoryRead: &enterpriseProjectRepositoryRead{Operation: "file", Path: "docs/spec.md", CommitID: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}}
	d := map[string]any{"repo_project_code": in.RepoProjectCode, "repo_file_path": in.RepositoryRead.Path, "repo_commit_id": in.RepositoryRead.CommitID}
	facts := map[string]any{"repositoryReference": true, "document": d}
	if !projectRepositoryDocumentMatches(facts, in) {
		t.Fatal("raw owning SQL document contract must match")
	}
	for _, key := range []string{"repo_project_code", "repo_file_path", "repo_commit_id"} {
		old := d[key]
		d[key] = "mismatched"
		if projectRepositoryDocumentMatches(facts, in) {
			t.Fatal("binding mismatch accepted", key)
		}
		d[key] = old
	}
	d["repoFilePath"] = "other.md"
	if projectRepositoryDocumentMatches(facts, in) {
		t.Fatal("contradictory aliases accepted")
	}
}
