package server

import (
	"context"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"testing"

	"github.com/golang-jwt/jwt/v5"
	"github.com/huizhi-yun/data-runtime/internal/auth"
)

// Every Host operation is registered in Foundation, including inputs that
// select dynamic Runtime route capabilities. The delegated route table and
// direct Runtime constructors add routes without a Host caller.
func enterpriseConstructibleCapabilities(t *testing.T) []string {
	t.Helper()
	capabilities := map[string]struct{}{}
	foundation, err := os.ReadFile("../../../foundation/server/utils/enterpriseRuntimeClient.ts")
	if err != nil {
		t.Fatal(err)
	}
	for _, match := range regexp.MustCompile(`capability: '([^']+)'`).FindAllStringSubmatch(string(foundation), -1) {
		capabilities[match[1]] = struct{}{}
	}
	for _, capability := range enterpriseDelegatedCapabilities() {
		capabilities[capability] = struct{}{}
	}
	files, err := filepath.Glob("enterprise_*.go")
	if err != nil {
		t.Fatal(err)
	}
	constructors := 0
	for _, path := range files {
		if strings.HasSuffix(path, "_test.go") {
			continue
		}
		file, err := parser.ParseFile(token.NewFileSet(), path, nil, 0)
		if err != nil {
			t.Fatal(err)
		}
		ast.Inspect(file, func(node ast.Node) bool {
			literal, ok := node.(*ast.CompositeLit)
			if !ok {
				return true
			}
			kind, ok := literal.Type.(*ast.Ident)
			if !ok || kind.Name != "enterpriseRouteContext" {
				return true
			}
			constructors++
			hasCapability := false
			for _, item := range literal.Elts {
				field, ok := item.(*ast.KeyValueExpr)
				if !ok {
					continue
				}
				key, ok := field.Key.(*ast.Ident)
				if !ok {
					continue
				}
				if key.Name == "Action" {
					t.Errorf("%s duplicates the capability action", path)
				}
				if key.Name != "Capability" {
					continue
				}
				hasCapability = true
				if value, ok := field.Value.(*ast.BasicLit); ok && value.Kind == token.STRING {
					capability, err := strconv.Unquote(value.Value)
					if err != nil {
						t.Error(err)
					} else {
						capabilities[capability] = struct{}{}
					}
				}
			}
			if !hasCapability {
				t.Errorf("%s has an Enterprise route without a capability", path)
			}
			return true
		})
	}
	if constructors == 0 || len(capabilities) == 0 {
		t.Fatal("Enterprise route capability catalog is empty")
	}
	if _, duplicate := reflect.TypeOf(enterpriseRouteContext{}).FieldByName("Action"); duplicate {
		t.Fatal("Enterprise route context must derive the authorization action from Capability")
	}
	list := make([]string, 0, len(capabilities))
	for capability := range capabilities {
		list = append(list, capability)
	}
	sort.Strings(list)
	return list
}

func TestAllConstructibleEnterpriseCapabilitiesAcceptExactIdentity(t *testing.T) {
	for _, capability := range enterpriseConstructibleCapabilities(t) {
		t.Run(capability, func(t *testing.T) {
			parts := strings.Split(capability, ":")
			if len(parts) != 3 || parts[0] == "" || parts[1] == "" || parts[2] == "" || strings.Contains(capability, "*") {
				t.Fatalf("invalid registered capability %q", capability)
			}
			a, request, route := enterpriseContextFixture(t, func(claims jwt.MapClaims) { claims["scope"] = capability }, true)
			route.LogicalTarget, route.Capability = parts[0], capability
			_, err := authenticateEnterpriseRequest(request, a, route, func(_ context.Context, _ auth.Context, requested string) (bool, error) {
				return requested == capability, nil
			})
			if err != nil {
				t.Fatalf("correctly scoped route rejected: %v", err)
			}
		})
	}
}

func TestEnterpriseRouteCapabilityShapeStillFailsClosed(t *testing.T) {
	for _, capability := range []string{
		"assets:product:", "assets::read", "assets:product:read:extra",
		"aims:product:read", "assets:product:*",
	} {
		t.Run(capability, func(t *testing.T) {
			a, request, route := enterpriseContextFixture(t, nil, true)
			route.Capability = capability
			_, err := authenticateEnterpriseRequest(request, a, route, func(context.Context, auth.Context, string) (bool, error) {
				t.Fatal("malformed route reached credential verification")
				return true, nil
			})
			if err == nil {
				t.Fatal("malformed route accepted")
			}
		})
	}
}
