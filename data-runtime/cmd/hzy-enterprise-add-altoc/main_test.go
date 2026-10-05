package main

import (
	"github.com/huizhi-yun/data-runtime/internal/config"
	"os"
	"path/filepath"
	"testing"
)

func TestPrivateInputAndExclusiveReceipt(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "config.json")
	if err := os.WriteFile(file, []byte("{}"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := privateRead(file); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(file, 0644); err != nil {
		t.Fatal(err)
	}
	if _, err := privateRead(file); err == nil {
		t.Fatal("shared file accepted")
	}
	os.Chmod(file, 0600)
	link := filepath.Join(dir, "link")
	if err := os.Symlink(file, link); err != nil {
		t.Fatal(err)
	}
	if _, err := privateRead(link); err == nil {
		t.Fatal("symlink accepted")
	}
	receipt := filepath.Join(dir, "receipt.json")
	if err := write(receipt, map[string]string{"safe": "receipt"}); err != nil {
		t.Fatal(err)
	}
	if err := write(receipt, map[string]string{"overwrite": "no"}); err == nil {
		t.Fatal("receipt overwritten")
	}
	info, err := os.Stat(receipt)
	if err != nil || info.Mode().Perm() != 0600 {
		t.Fatal("unsafe receipt mode", err)
	}
}

func TestLaunchctlExplicitDisabledForms(t *testing.T) {
	for _, raw := range []string{`"cn.wiztek.hzy-test-runtime" => disabled`, `"cn.wiztek.hzy-test-runtime" => true`} {
		if !runtimeDisabled(raw) {
			t.Fatal("explicit disabled rejected")
		}
	}
	for _, raw := range []string{`"cn.wiztek.hzy-test-runtime" => enabled`, `"cn.wiztek.hzy-test-runtime" => false`, `"cn.wiztek.hzy-test-runtime-other" => disabled`, `"cn.wiztek.hzy-test-runtime" => unknown`, `"cn.wiztek.hzy-test-runtime" => disabled` + "\n" + `"cn.wiztek.hzy-test-runtime" => enabled`} {
		if runtimeDisabled(raw) {
			t.Fatal("unproven disabled accepted")
		}
	}
}

func TestMigrationConnectionCannotRetarget(t *testing.T) {
	r := config.DBConfig{Host: "127.0.0.1", Port: 3306, Database: "local", User: "runtime"}
	a := r
	a.User = "migration"
	if _, e := migrationConnection(r, a); e != nil {
		t.Fatal(e)
	}
	for _, change := range []func(*config.DBConfig){func(v *config.DBConfig) { v.Host = "remote" }, func(v *config.DBConfig) { v.Port = 3307 }, func(v *config.DBConfig) { v.Database = "other" }, func(v *config.DBConfig) { v.User = "" }} {
		v := a
		change(&v)
		if _, e := migrationConnection(r, v); e == nil {
			t.Fatal("migration account retargeted")
		}
	}
}
