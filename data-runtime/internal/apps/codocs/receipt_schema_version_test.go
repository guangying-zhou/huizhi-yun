package codocs

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// service_command_receipt.command_schema_version is VARCHAR(30) in every
// module schema; an overlong identifier fails the receipt insert in strict SQL
// mode (Error 1406) and the command returns 500.
func TestReceiptCommandSchemaVersionsFitColumn(t *testing.T) {
	// Only values written to the receipt: `CommandSchemaVersion:` literals or
	// the constants they reference. Signed read-command schemas are not stored.
	field := regexp.MustCompile(`CommandSchemaVersion:\s*(?:"([^"]+)"|([A-Za-z_][A-Za-z0-9_]*))`)
	constant := regexp.MustCompile(`(?m)^\s*(?:const\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"([^"]+)"`)
	files, err := filepath.Glob("*.go")
	if err != nil {
		t.Fatal(err)
	}
	constants := map[string]string{}
	sources := map[string]string{}
	for _, file := range files {
		if strings.HasSuffix(file, "_test.go") {
			continue
		}
		source, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		sources[file] = string(source)
		for _, match := range constant.FindAllStringSubmatch(string(source), -1) {
			constants[match[1]] = match[2]
		}
	}
	found := 0
	for file, source := range sources {
		for _, match := range field.FindAllStringSubmatch(source, -1) {
			version, ok := match[1], match[1] != ""
			if !ok {
				version, ok = constants[match[2]]
			}
			if !ok {
				continue // runtime value, e.g. copied from a stored receipt
			}
			found++
			if len(version) > 30 {
				t.Errorf("%s: receipt schema version %q exceeds 30 characters", file, version)
			}
		}
	}
	if found < 8 {
		t.Fatalf("expected the codocs receipt schema versions, found %d", found)
	}
}

// Every Codocs-owned receipt (source_app = target_app = 'codocs') must be listed
// in the owned-receipt CHECK, otherwise the insert fails with Error 3819.
func TestOwnedReceiptCheckCoversCodocsCommands(t *testing.T) {
	migration, err := os.ReadFile("../../../../codocs/docs/migrations/20260922_codocs_owned_command_receipts.sql")
	if err != nil {
		t.Fatal(err)
	}
	constant := regexp.MustCompile(`(?m)^\s*(?:const\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"([^"]+)"`)
	value := func(expression string, constants map[string]string) string {
		if strings.HasPrefix(expression, `"`) {
			return strings.Trim(expression, `"`)
		}
		return constants[expression]
	}
	field := func(name, source string) string {
		match := regexp.MustCompile(name + `:\s*("[^"]*"|[A-Za-z_][A-Za-z0-9_]*)`).FindStringSubmatch(source)
		if match == nil {
			return ""
		}
		return match[1]
	}
	files, _ := filepath.Glob("*.go")
	constants := map[string]string{}
	var owned []string
	for _, file := range files {
		if strings.HasSuffix(file, "_test.go") {
			continue
		}
		source, _ := os.ReadFile(file)
		for _, match := range constant.FindAllStringSubmatch(string(source), -1) {
			constants[match[1]] = match[2]
		}
		if strings.Contains(string(source), `TargetApp: "codocs"`) {
			owned = append(owned, string(source))
		}
	}
	lines := strings.Split(string(migration), "\n")
	for _, source := range owned {
		operation := value(field("OperationCode", source), constants)
		schema := value(field("CommandSchemaVersion", source), constants)
		capability := value(field("RequiredCapability", source), constants)
		if operation == "" || schema == "" {
			t.Fatalf("owned command identity unresolved: %q %q", operation, schema)
		}
		covered := false
		for _, line := range lines {
			if strings.Contains(line, "operation_code = '"+operation+"'") && strings.Contains(line, "command_schema_version = '"+schema+"'") &&
				(capability == "" || strings.HasSuffix(capability, ":") || strings.Contains(line, "'"+capability+"'")) {
				covered = true
			}
		}
		if !covered {
			t.Errorf("owned command %s (%s, %s) is not allowed by the receipt CHECK", operation, capability, schema)
		}
	}
	if len(owned) < 8 {
		t.Fatalf("expected the codocs owned commands, found %d", len(owned))
	}
}
