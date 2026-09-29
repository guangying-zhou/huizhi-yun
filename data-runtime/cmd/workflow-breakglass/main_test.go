package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestProtectedSecretFile(t *testing.T) {
	dir := t.TempDir()
	if err := os.Chmod(dir, 0700); err != nil {
		t.Fatal(err)
	}
	if err := prepareCaseSecretDirectory(dir, "incident-1"); err != nil {
		t.Fatal(err)
	}
	path := caseSecretPath(dir, "incident-1")
	cleanup, err := writeSecretFile(path, "workflow.maintenance.incident-1", "fixture-secret")
	if err != nil {
		t.Fatal(err)
	}
	defer cleanup()
	info, err := os.Lstat(path)
	if err != nil || info.Mode().Perm() != 0600 {
		t.Fatal("secret file mode", err)
	}
	raw, err := protectedFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var saved map[string]string
	if json.Unmarshal(raw, &saved) != nil || saved["client_secret"] != "fixture-secret" {
		t.Fatal("secret file content invalid")
	}
	if _, err = writeSecretFile(path, "another", "another"); err == nil {
		t.Fatal("existing secret file overwritten")
	}
	if err = os.Chmod(path, 0644); err != nil {
		t.Fatal(err)
	}
	if _, err = protectedFile(path); err == nil {
		t.Fatal("world-readable secret file accepted")
	}
	if err = os.Chmod(filepath.Dir(path), 0755); err != nil {
		t.Fatal(err)
	}
	if _, err = writeSecretFile(filepath.Join(filepath.Dir(path), "another.json"), "another", "another"); err == nil {
		t.Fatal("world-readable directory accepted")
	}
}
