// Package enterprise contains opt-in ADR-018 infrastructure. Existing adapters
// remain outside this registry until their migration contract is registered.
package enterprise

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net"
	"regexp"
	"strconv"
	"strings"
	"sync"
)

var (
	ErrInvalidBinding        = errors.New("enterprise: invalid binding")
	ErrBindingExists         = errors.New("enterprise: binding already exists")
	ErrBindingNotFound       = errors.New("enterprise: binding not found")
	ErrBindingMismatch       = errors.New("enterprise: binding context mismatch")
	ErrStorageTenantConflict = errors.New("enterprise: storage already belongs to another tenant")
	ErrPathDisabled          = errors.New("enterprise: path not enabled")
	ErrRegistryClosed        = errors.New("enterprise: registry closed")
)

type BindingKey struct{ Tenant, Environment, RuntimeDeployment string }

// Storage is trusted local configuration, never a request parameter. Address
// is used only by the factory; InstanceID is the server UUID verified by the
// factory against MySQL before returning a pool. Aliased network addresses do
// not create distinct storage identities. No secrets are stored here.
type Storage struct{ InstanceID, Address, Database string }
type storageKey struct{ instanceID, database string }

func (s Storage) key() storageKey { return storageKey{s.InstanceID, s.Database} }

type ConnectionFactory func(context.Context, Storage) (*sql.DB, error)
type PathMode string

const (
	PathLegacy   PathMode = "legacy"
	PathUnified  PathMode = "unified"
	PathDisabled PathMode = "disabled"
)

type Operation string

const (
	Read      Operation = "read"
	Write     Operation = "write"
	Scheduler Operation = "scheduler"
)

type DomainBinding struct {
	OwnerDeployment        string
	Tables                 map[string]string
	Read, Write, Scheduler PathMode
}
type Binding struct {
	Key           BindingKey
	Storage       Storage
	SchemaVersion string
	Generation    uint64
	Domains       map[string]DomainBinding
}
type ResolveRequest struct {
	Key                                    BindingKey
	Domain, OwnerDeployment, SchemaVersion string
	Generation                             uint64
	Operation                              Operation
}

// Resolved is a snapshot. Callers must not close DB; Registry owns its lifetime.
// Domain authorization and transaction ownership remain the caller's duty.
type Resolved struct {
	DB                                     *sql.DB
	Key                                    BindingKey
	Domain, OwnerDeployment, SchemaVersion string
	Generation                             uint64
	tables                                 map[string]string
}

func (r Resolved) Table(logical string) (string, error) {
	table, ok := r.tables[logical]
	if !ok {
		return "", fmt.Errorf("%w: table mapping missing", ErrBindingMismatch)
	}
	return "`" + table + "`", nil
}

type poolEntry struct {
	tenant        string
	db            *sql.DB
	schemaVersion string
	tableOwners   map[string]string
}
type Registry struct {
	mu       sync.Mutex
	factory  ConnectionFactory
	bindings map[BindingKey]Binding
	pools    map[storageKey]poolEntry
	closed   bool
}

func NewRegistry(factory ConnectionFactory) *Registry {
	return &Registry{factory: factory, bindings: make(map[BindingKey]Binding), pools: make(map[storageKey]poolEntry)}
}

var identifier = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]{0,63}$`)

func nonempty(v string) bool {
	return v != "" && strings.TrimSpace(v) == v && !strings.ContainsAny(v, "\x00\r\n")
}
func validKey(k BindingKey) bool {
	return nonempty(k.Tenant) && nonempty(k.Environment) && nonempty(k.RuntimeDeployment)
}
func validMode(m PathMode) bool { return m == PathLegacy || m == PathUnified || m == PathDisabled }
func normalizeBinding(b Binding) (Binding, error) {
	if !validKey(b.Key) || !nonempty(b.SchemaVersion) || b.Generation == 0 || len(b.Domains) == 0 || !identifier.MatchString(b.Storage.Database) || !nonempty(b.Storage.InstanceID) {
		return Binding{}, ErrInvalidBinding
	}
	host, port, err := net.SplitHostPort(b.Storage.Address)
	if err != nil || host == "" || strings.TrimSpace(host) != host {
		return Binding{}, ErrInvalidBinding
	}
	n, err := strconv.Atoi(port)
	if err != nil || n < 1 || n > 65535 {
		return Binding{}, ErrInvalidBinding
	}
	b.Storage.InstanceID = strings.ToLower(b.Storage.InstanceID)
	b.Storage.Address = net.JoinHostPort(strings.ToLower(host), strconv.Itoa(n))
	domains := make(map[string]DomainBinding, len(b.Domains))
	physicalOwners := map[string]string{}
	for name, d := range b.Domains {
		if !identifier.MatchString(name) || !nonempty(d.OwnerDeployment) || len(d.Tables) == 0 || !validMode(d.Read) || !validMode(d.Write) || !validMode(d.Scheduler) {
			return Binding{}, ErrInvalidBinding
		}
		tables := make(map[string]string, len(d.Tables))
		for logical, physical := range d.Tables {
			if !identifier.MatchString(logical) || !identifier.MatchString(physical) {
				return Binding{}, ErrInvalidBinding
			}
			// A physical table has one owning domain, even if other domains query it
			// through an owning-domain service. Prevent receipt/outbox collisions.
			if owner, exists := physicalOwners[strings.ToLower(physical)]; exists && owner != name {
				return Binding{}, ErrInvalidBinding
			}
			physicalOwners[strings.ToLower(physical)] = name
			tables[logical] = physical
		}
		d.Tables = tables
		domains[name] = d
	}
	b.Domains = domains
	return b, nil
}

// Register freezes a complete local binding and opens at most one pool per
// canonical storage identity. Failed registration leaves no binding behind.
// Calls are serialized with Close so no newly opened pool can be leaked.
func (r *Registry) Register(ctx context.Context, b Binding) error {
	b, err := normalizeBinding(b)
	if err != nil {
		return err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed {
		return ErrRegistryClosed
	}
	if r.factory == nil {
		return ErrInvalidBinding
	}
	if _, ok := r.bindings[b.Key]; ok {
		return ErrBindingExists
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	pool, ok := r.pools[b.Storage.key()]
	if ok && pool.tenant != b.Key.Tenant {
		return ErrStorageTenantConflict
	}
	if ok {
		if pool.schemaVersion != b.SchemaVersion {
			return ErrBindingMismatch
		}
		for domain, d := range b.Domains {
			for _, table := range d.Tables {
				if owner, exists := pool.tableOwners[strings.ToLower(table)]; exists && owner != domain {
					return ErrInvalidBinding
				}
			}
		}
	}
	if !ok {
		db, err := r.factory(ctx, b.Storage)
		if err != nil {
			if db != nil {
				_ = db.Close()
			}
			return fmt.Errorf("enterprise: connection factory failed: %w", err)
		}
		if db == nil {
			return ErrInvalidBinding
		}
		if err := ctx.Err(); err != nil {
			_ = db.Close()
			return err
		}
		pool = poolEntry{tenant: b.Key.Tenant, db: db, schemaVersion: b.SchemaVersion, tableOwners: make(map[string]string)}
		r.pools[b.Storage.key()] = pool
	}
	for domain, d := range b.Domains {
		for _, table := range d.Tables {
			pool.tableOwners[strings.ToLower(table)] = domain
		}
	}
	r.bindings[b.Key] = b
	return nil
}
func (r *Registry) Resolve(req ResolveRequest) (Resolved, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed {
		return Resolved{}, ErrRegistryClosed
	}
	if !validKey(req.Key) || req.Generation == 0 || !nonempty(req.SchemaVersion) || !nonempty(req.OwnerDeployment) {
		return Resolved{}, ErrBindingMismatch
	}
	b, ok := r.bindings[req.Key]
	if !ok {
		return Resolved{}, ErrBindingNotFound
	}
	d, ok := b.Domains[req.Domain]
	if !ok || b.Generation != req.Generation || b.SchemaVersion != req.SchemaVersion || d.OwnerDeployment != req.OwnerDeployment {
		return Resolved{}, ErrBindingMismatch
	}
	var mode PathMode
	switch req.Operation {
	case Read:
		mode = d.Read
	case Write:
		mode = d.Write
	case Scheduler:
		mode = d.Scheduler
	default:
		return Resolved{}, ErrBindingMismatch
	}
	// Legacy is deliberately not resolved: its existing registry remains the
	// authority. A read in unified mode cannot enable write or scheduler paths.
	if mode != PathUnified {
		return Resolved{}, ErrPathDisabled
	}
	return Resolved{DB: r.pools[b.Storage.key()].db, Key: b.Key, Domain: req.Domain, OwnerDeployment: d.OwnerDeployment, SchemaVersion: b.SchemaVersion, Generation: b.Generation, tables: d.Tables}, nil
}
func (r *Registry) Close() error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed {
		return nil
	}
	r.closed = true
	var errs []error
	for _, pool := range r.pools {
		if err := pool.db.Close(); err != nil {
			errs = append(errs, err)
		}
	}
	r.bindings = nil
	r.pools = nil
	return errors.Join(errs...)
}

// ValidateBinding checks trusted configuration without opening a connection.
func ValidateBinding(b Binding) error { _, err := normalizeBinding(b); return err }
