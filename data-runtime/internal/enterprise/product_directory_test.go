package enterprise

import (
	"context"
	"database/sql"
	"errors"
	"testing"
	"time"
)

func TestDirectoryGrantCannotBroadenOrCrossIdentity(t *testing.T) {
	id := DirectoryIdentity{Key: BindingKey{"tenant", "test", "runtime"}, ActorUID: "actor", SchemaVersion: "v1", Generation: 1}
	base := DirectoryGrant{Key: id.Key, ActorUID: id.ActorUID, SchemaVersion: id.SchemaVersion, Generation: id.Generation, ExpiresAt: time.Now().Add(time.Minute), ProductCodes: []string{"A"}}
	for name, change := range map[string]func(*DirectoryGrant){"tenant": func(g *DirectoryGrant) { g.Key.Tenant = "other" }, "actor": func(g *DirectoryGrant) { g.ActorUID = "other" }, "schema": func(g *DirectoryGrant) { g.SchemaVersion = "v0" }, "generation": func(g *DirectoryGrant) { g.Generation++ }, "expired": func(g *DirectoryGrant) { g.ExpiresAt = time.Now().Add(-time.Minute) }, "ambiguous all": func(g *DirectoryGrant) { g.AllProducts = true }, "invalid code": func(g *DirectoryGrant) { g.ProductCodes = []string{"\x00"} }} {
		t.Run(name, func(t *testing.T) {
			g := base
			change(&g)
			if _, _, err := grantWhere(id, g); !errors.Is(err, ErrDirectoryAccess) {
				t.Fatal(err)
			}
		})
	}
	empty := base
	empty.ProductCodes = nil
	if where, args, err := grantWhere(id, empty); err != nil || where != "1=0" || len(args) != 0 {
		t.Fatal(where, args, err)
	}
	if _, args, err := grantWhere(id, base); err != nil || len(args) != 1 || args[0] != "A" {
		t.Fatal(args, err)
	}
}
func TestDirectoryMissingDependenciesFailClosed(t *testing.T) {
	if _, err := (ProductDirectoryService{}).List(context.Background(), DirectoryIdentity{}, DirectoryQuery{}); !errors.Is(err, ErrDirectoryAccess) {
		t.Fatal(err)
	}
}
func TestDirectoryResolveRejectsUnboundedOrMalformedBatches(t *testing.T) {
	id := DirectoryIdentity{SourceDomain: "assets", Key: BindingKey{"tenant", "test", "runtime"}, ActorUID: "actor", SchemaVersion: "v1", Generation: 1}
	service := ProductDirectoryService{Registry: &Registry{}, Authorizer: stubDirectoryAuthorizer{}}
	oversized := make([]string, directoryResolveLimit+1)
	for i := range oversized {
		oversized[i] = "P-" + string(rune('A'+i%26)) + string(rune('0'+i%10)) + string(rune('a'+(i/10)%26))
	}
	for name, codes := range map[string][]string{
		"empty":     {},
		"oversized": oversized,
		"duplicate": {"A", "A"},
		"blank":     {""},
		"control":   {"\x00"},
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := service.Resolve(context.Background(), id, codes); !errors.Is(err, ErrDirectoryQuery) {
				t.Fatalf("accepted %s batch: %v", name, err)
			}
		})
	}
	// Missing dependencies and foreign source domains must fail closed before any read.
	if _, err := (ProductDirectoryService{}).Resolve(context.Background(), id, []string{"A"}); !errors.Is(err, ErrDirectoryAccess) {
		t.Fatal(err)
	}
	foreign := id
	foreign.SourceDomain = "finance"
	if _, err := service.Resolve(context.Background(), foreign, []string{"A"}); !errors.Is(err, ErrDirectoryAccess) {
		t.Fatal(err)
	}
}

type stubDirectoryAuthorizer struct{}

func (stubDirectoryAuthorizer) AssetsProductsView(context.Context, *sql.Tx, DirectoryIdentity) (DirectoryGrant, error) {
	return DirectoryGrant{}, ErrDirectoryAccess
}
func (stubDirectoryAuthorizer) AimsProductsView(context.Context, *sql.Tx, DirectoryIdentity, string) error {
	return ErrDirectoryAccess
}
