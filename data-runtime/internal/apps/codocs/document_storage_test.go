package codocs

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDocumentStorageClassification(t *testing.T) {
	for docType, want := range map[string]bool{"project": true, "git-project": true, "department": false, "private": false, "": false} {
		if got := isProjectFamilyDocType(docType); got != want {
			t.Fatalf("isProjectFamilyDocType(%q)=%v", docType, got)
		}
	}
	if got := projectFamilyCondition("d.doc_type"); got != "d.doc_type IN ('project', 'git-project')" {
		t.Fatalf("project family condition=%q", got)
	}
	if got := notRepositoryCopyCondition("doc_type"); got != "doc_type <> 'git-project'" {
		t.Fatalf("repository copy exclusion=%q", got)
	}
}

// The repository-copy discriminator must live in document_storage.go only, so
// the later move to documents.storage_locator changes a single file.
func TestRepositoryCopyDiscriminatorHasSingleOwner(t *testing.T) {
	files, err := filepath.Glob("*.go")
	if err != nil || len(files) == 0 {
		t.Fatal(err)
	}
	for _, file := range files {
		if file == "document_storage.go" || strings.HasSuffix(file, "_test.go") {
			continue
		}
		source, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(string(source), "git-project") {
			t.Fatalf("%s compares the repository-copy doc type directly; use document_storage.go", file)
		}
	}
}
