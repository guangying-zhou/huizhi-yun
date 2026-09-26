package codocs

import (
	"database/sql"
	"net/http"
	"strings"
	"testing"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func sqlNullInt64(value int64) sql.NullInt64 { return sql.NullInt64{Int64: value, Valid: true} }

const snapshotTestUUID = "12345678-1234-4234-8234-123456789abc"

func validSnapshotIdentity() PersonalFolderCreationIdentity {
	return PersonalFolderCreationIdentity{
		Tenant: "tenant-a", Deployment: "deployment-a", Actor: "actor-a",
		Client: "enterprise.runtime", Key: "request-key-a",
	}
}

func validSnapshotCommand() SnapshotCommand {
	return SnapshotCommand{
		UUID: snapshotTestUUID, Generation: 7, Epoch: 2,
		MarkdownSHA256: strings.Repeat("a", 64), MarkdownSize: 10,
	}
}

func snapshotValidationError(t *testing.T, err error, status int, code string) {
	t.Helper()
	if err == nil {
		t.Fatalf("expected %s, got nil", code)
	}
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != status || httpErr.Code != code {
		t.Fatalf("error = %#v, want status=%d code=%q", err, status, code)
	}
}

func TestSnapshotFactsRejectsInvalidIdentity(t *testing.T) {
	base := validSnapshotIdentity()
	for name, mutate := range map[string]func(*PersonalFolderCreationIdentity){
		"empty tenant":      func(id *PersonalFolderCreationIdentity) { id.Tenant = "" },
		"whitespace tenant": func(id *PersonalFolderCreationIdentity) { id.Tenant = "  " },
		"nul deployment":    func(id *PersonalFolderCreationIdentity) { id.Deployment = "deployment\x00a" },
		"oversized actor":   func(id *PersonalFolderCreationIdentity) { id.Actor = strings.Repeat("x", 201) },
		"empty key":         func(id *PersonalFolderCreationIdentity) { id.Key = "" },
		"padded tenant":     func(id *PersonalFolderCreationIdentity) { id.Tenant = "tenant-a " },
		"wrong client":      func(id *PersonalFolderCreationIdentity) { id.Client = "browser" },
	} {
		t.Run(name, func(t *testing.T) {
			id := base
			mutate(&id)
			_, _, _, err := snapshotFacts(id, validSnapshotCommand())
			snapshotValidationError(t, err, http.StatusForbidden, "snapshot_identity_invalid")
		})
	}
}

func TestSnapshotFactsNamespacesEveryIdentityComponent(t *testing.T) {
	base := validSnapshotIdentity()
	cmd := validSnapshotCommand()
	key, _, prefix, err := snapshotFacts(base, cmd)
	if err != nil {
		t.Fatal(err)
	}
	for name, mutate := range map[string]func(*PersonalFolderCreationIdentity){
		"tenant":     func(id *PersonalFolderCreationIdentity) { id.Tenant += "-other" },
		"deployment": func(id *PersonalFolderCreationIdentity) { id.Deployment += "-other" },
		"actor":      func(id *PersonalFolderCreationIdentity) { id.Actor += "-other" },
		"key":        func(id *PersonalFolderCreationIdentity) { id.Key += "-other" },
	} {
		t.Run(name, func(t *testing.T) {
			id := base
			mutate(&id)
			otherKey, _, otherPrefix, err := snapshotFacts(id, cmd)
			if err != nil {
				t.Fatal(err)
			}
			if otherKey == key || otherPrefix == prefix {
				t.Fatalf("identity component %s was not namespaced: key=%q prefix=%q", name, otherKey, otherPrefix)
			}
		})
	}
}

func TestSnapshotFactsCommandDigestChangesWithCommand(t *testing.T) {
	id := validSnapshotIdentity()
	_, digest, _, err := snapshotFacts(id, validSnapshotCommand())
	if err != nil {
		t.Fatal(err)
	}
	changed := validSnapshotCommand()
	changed.MarkdownSize++
	_, changedDigest, _, err := snapshotFacts(id, changed)
	if err != nil {
		t.Fatal(err)
	}
	if digest == changedDigest {
		t.Fatal("command mutation did not change digest")
	}
}

func TestSnapshotFactsRejectsGenerationAndContentBoundaries(t *testing.T) {
	id := validSnapshotIdentity()
	tests := []struct {
		name   string
		mutate func(*SnapshotCommand)
	}{
		{"negative generation", func(c *SnapshotCommand) { c.Generation = -1 }},
		{"generation overflow", func(c *SnapshotCommand) { c.Generation = int64(^uint64(0) >> 1) }},
		{"negative epoch", func(c *SnapshotCommand) { c.Epoch = -1 }},
		{"markdown too large", func(c *SnapshotCommand) { c.MarkdownSize = 10*1024*1024 + 1 }},
		{"markdown negative", func(c *SnapshotCommand) { c.MarkdownSize = -1 }},
		{"markdown hash malformed", func(c *SnapshotCommand) { c.MarkdownSHA256 = "bad" }},
		{"yjs hash without size", func(c *SnapshotCommand) { c.YjsSHA256 = strings.Repeat("b", 64); c.YjsSize = 0 }},
		{"yjs size without hash", func(c *SnapshotCommand) { c.YjsSize = 1 }},
		{"yjs too large", func(c *SnapshotCommand) { c.YjsSHA256 = strings.Repeat("b", 64); c.YjsSize = 100*1024*1024 + 1 }},
		{"yjs hash malformed", func(c *SnapshotCommand) { c.YjsSHA256 = "bad"; c.YjsSize = 1 }},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			cmd := validSnapshotCommand()
			tc.mutate(&cmd)
			_, _, _, err := snapshotFacts(id, cmd)
			snapshotValidationError(t, err, http.StatusBadRequest, "snapshot_command_invalid")
		})
	}
	for name, size := range map[string]int64{"markdown max": 10 * 1024 * 1024, "yjs max": 100 * 1024 * 1024} {
		t.Run(name, func(t *testing.T) {
			cmd := validSnapshotCommand()
			if name == "markdown max" {
				cmd.MarkdownSize = size
			} else {
				cmd.YjsSHA256, cmd.YjsSize = strings.Repeat("b", 64), size
			}
			if _, _, _, err := snapshotFacts(id, cmd); err != nil {
				t.Fatalf("boundary should be accepted: %v", err)
			}
		})
	}
}

func TestValidateSnapshotObjectsEnforcesPrefixVersionsAndPairAttempt(t *testing.T) {
	id, cmd := validSnapshotIdentity(), validSnapshotCommand()
	_, _, prefix, err := snapshotFacts(id, cmd)
	if err != nil {
		t.Fatal(err)
	}
	attempt := strings.Repeat("a", 32)
	markdown := SnapshotObject{Key: prefix + attempt + "/body.md", Version: "v1"}
	for name, mutate := range map[string]func(*SnapshotObject){
		"wrong prefix":    func(o *SnapshotObject) { o.Key = "other/" + o.Key },
		"wrong suffix":    func(o *SnapshotObject) { o.Key = prefix + attempt + "/body.txt" },
		"null version":    func(o *SnapshotObject) { o.Version = "null" },
		"padded version":  func(o *SnapshotObject) { o.Version = " v1 " },
		"newline version": func(o *SnapshotObject) { o.Version = "v1\n" },
		"bad attempt":     func(o *SnapshotObject) { o.Key = prefix + "not-an-attempt/body.md" },
	} {
		t.Run(name, func(t *testing.T) {
			o := markdown
			mutate(&o)
			snapshotValidationError(t, validateSnapshotObjects(prefix, cmd, SnapshotObjects{Markdown: o}), http.StatusBadRequest, "snapshot_object_invalid")
		})
	}

	noYJS := SnapshotObjects{Markdown: markdown, Yjs: &SnapshotObject{Key: prefix + attempt + "/state.yjs", Version: "v1"}}
	snapshotValidationError(t, validateSnapshotObjects(prefix, cmd, noYJS), http.StatusBadRequest, "snapshot_pair_invalid")

	cmd.YjsSHA256 = strings.Repeat("b", 64)
	tests := []struct {
		name    string
		objects SnapshotObjects
	}{
		{"missing yjs", SnapshotObjects{Markdown: markdown}},
		{"mismatched pair attempt", SnapshotObjects{Markdown: markdown, Yjs: &SnapshotObject{Key: prefix + strings.Repeat("b", 32) + "/state.yjs", Version: "v1"}}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			snapshotValidationError(t, validateSnapshotObjects(prefix, cmd, tc.objects), http.StatusBadRequest, "snapshot_pair_invalid")
		})
	}
}

func TestCheckSnapshotCandidateRejectsIncompletePublicationReceipt(t *testing.T) {
	cmd := validSnapshotCommand()
	digest := "digest"
	tests := []struct {
		name      string
		candidate snapshotCandidate
		status    int
		code      string
	}{
		{"uuid conflict", snapshotCandidate{uuid: "other", digest: digest, state: "prepared"}, http.StatusConflict, "snapshot_key_conflict"},
		{"digest conflict", snapshotCandidate{uuid: cmd.UUID, digest: "other", state: "prepared"}, http.StatusConflict, "snapshot_key_conflict"},
		{"unknown state", snapshotCandidate{uuid: cmd.UUID, digest: digest, state: "uploaded"}, http.StatusServiceUnavailable, "snapshot_candidate_invalid"},
		{"published null generation", snapshotCandidate{uuid: cmd.UUID, digest: digest, state: "published"}, http.StatusServiceUnavailable, "snapshot_candidate_invalid"},
		{"published wrong generation", snapshotCandidate{uuid: cmd.UUID, digest: digest, state: "published", generation: sqlNullInt64(9)}, http.StatusServiceUnavailable, "snapshot_candidate_invalid"},
		{"prepared with receipt", snapshotCandidate{uuid: cmd.UUID, digest: digest, state: "prepared", generation: sqlNullInt64(8)}, http.StatusServiceUnavailable, "snapshot_candidate_invalid"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			snapshotValidationError(t, checkSnapshotCandidate(tc.candidate, cmd, digest), tc.status, tc.code)
		})
	}
	if err := checkSnapshotCandidate(snapshotCandidate{uuid: cmd.UUID, digest: digest, state: "published", generation: sqlNullInt64(cmd.Generation + 1)}, cmd, digest); err != nil {
		t.Fatalf("complete published receipt rejected: %v", err)
	}
}
