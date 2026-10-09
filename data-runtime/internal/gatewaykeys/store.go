// Package gatewaykeys distributes verification keys only. It grants no business
// authority and does not enable the Gateway exchange route.
package gatewaykeys

import (
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"sync"
	"time"
)

const Schema = "hzy-gateway-keyset.v1"
const MaxAgeMS int64 = 300000
const MaxLifetimeMS int64 = 90 * 86400000

var ErrInvalid = errors.New("gateway_keyset_invalid")
var ErrRollback = errors.New("gateway_keyset_rollback")
var ErrUnavailable = errors.New("gateway_keyset_unavailable")
var ErrStorage = errors.New("gateway_keyset_storage_unavailable")
var idPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]*$`)
var kidPattern = regexp.MustCompile(`^[0-9a-f]{64}$`)

type Binding struct {
	Tenant            string `json:"tenant"`
	Environment       string `json:"environment"`
	RuntimeCode       string `json:"runtimeCode"`
	GatewayDeployment string `json:"gatewayDeployment"`
}
type Key struct {
	KID       string `json:"kid"`
	PublicKey string `json:"publicKey"`
	Status    string `json:"status"`
	NotBefore int64  `json:"notBefore"`
	NotAfter  int64  `json:"notAfter"`
}
type Body struct {
	Tenant            string `json:"tenant"`
	Environment       string `json:"environment"`
	RuntimeCode       string `json:"runtimeCode"`
	GatewayDeployment string `json:"gatewayDeployment"`
	Revision          uint64 `json:"revision"`
	IssuedAt          int64  `json:"issuedAt"`
	ExpiresAt         int64  `json:"expiresAt"`
	Keys              []Key  `json:"keys"`
}
type Envelope struct {
	Schema    string `json:"schema"`
	Alg       string `json:"alg"`
	KID       string `json:"kid"`
	Body      string `json:"body"`
	Signature string `json:"signature"`
}
type diskState struct {
	Envelope Envelope `json:"envelope"`
	Blocked  bool     `json:"blocked"`
}
type Store struct {
	mu          sync.RWMutex
	binding     Binding
	root        ed25519.PublicKey
	rootID      string
	path        string
	envelope    Envelope
	body        Body
	fingerprint [32]byte
	ready       bool
	failure     error
}

func New(binding Binding, rootID, rootPEM, path string) (*Store, error) {
	for _, v := range []string{binding.Tenant, binding.Environment, binding.RuntimeCode, binding.GatewayDeployment} {
		if !idPattern.MatchString(v) {
			return nil, ErrInvalid
		}
	}
	if len(binding.Tenant) > 64 || len(binding.Environment) > 32 || len(binding.RuntimeCode) > 128 || len(binding.GatewayDeployment) > 128 || rootID == "" || path == "" {
		return nil, ErrInvalid
	}
	block, rest := pem.Decode([]byte(rootPEM))
	if block == nil || block.Type != "PUBLIC KEY" || len(bytes.TrimSpace(rest)) != 0 {
		return nil, ErrInvalid
	}
	parsed, err := x509.ParsePKIXPublicKey(block.Bytes)
	if err != nil {
		return nil, ErrInvalid
	}
	root, ok := parsed.(ed25519.PublicKey)
	if !ok {
		return nil, ErrInvalid
	}
	s := &Store{binding: binding, root: root, rootID: rootID, path: path}
	raw, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return s, nil
	}
	if err != nil {
		return nil, ErrUnavailable
	}
	var disk diskState
	if strictJSON(raw, &disk) != nil {
		return nil, ErrInvalid
	}
	// Persisted signatures establish a rollback floor even if expired. Boot never
	// authorizes from disk: a successful fresh pull is mandatory after every restart.
	body, fp, err := s.verify(disk.Envelope, 0, false)
	if err != nil {
		return nil, err
	}
	s.envelope = disk.Envelope
	s.body = body
	s.fingerprint = fp
	if disk.Blocked {
		s.failure = ErrInvalid
	}
	return s, nil
}
func (s *Store) verify(e Envelope, now int64, fresh bool) (Body, [32]byte, error) {
	var zero [32]byte
	if e.Schema != Schema || e.Alg != "Ed25519" || e.KID != s.rootID || len(e.Body) > 32768 {
		return Body{}, zero, ErrInvalid
	}
	sig, err := base64.RawURLEncoding.DecodeString(e.Signature)
	if err != nil || base64.RawURLEncoding.EncodeToString(sig) != e.Signature || !ed25519.Verify(s.root, []byte(Schema+"\n"+e.Body), sig) {
		return Body{}, zero, ErrInvalid
	}
	var b Body
	if strictJSON([]byte(e.Body), &b) != nil {
		return b, zero, ErrInvalid
	}
	if b.Tenant != s.binding.Tenant || b.Environment != s.binding.Environment || b.RuntimeCode != s.binding.RuntimeCode || b.GatewayDeployment != s.binding.GatewayDeployment || b.Revision == 0 || b.Revision > 9007199254740991 || b.IssuedAt < 0 || b.ExpiresAt <= b.IssuedAt || b.ExpiresAt-b.IssuedAt > MaxAgeMS || b.ExpiresAt > 9007199254740991 || b.Keys == nil || len(b.Keys) > 2 {
		return b, zero, ErrInvalid
	}
	if fresh && (b.IssuedAt > now+30000 || b.ExpiresAt <= now) {
		return b, zero, ErrInvalid
	}
	seen := map[string]bool{}
	for _, key := range b.Keys {
		raw, err := base64.RawURLEncoding.DecodeString(key.PublicKey)
		h := sha256.Sum256(raw)
		if err != nil || len(raw) != ed25519.PublicKeySize || base64.RawURLEncoding.EncodeToString(raw) != key.PublicKey || !kidPattern.MatchString(key.KID) || hex.EncodeToString(h[:]) != key.KID || seen[key.KID] || (key.Status != "next" && key.Status != "active") || key.NotBefore < 0 || key.NotAfter <= key.NotBefore || key.NotAfter-key.NotBefore > MaxLifetimeMS || key.NotAfter > 9007199254740991 {
			return b, zero, ErrInvalid
		}
		seen[key.KID] = true
	}
	sorted := append([]Key{}, b.Keys...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].KID < sorted[j].KID })
	core := struct {
		Binding  Binding
		Revision uint64
		Keys     []Key
	}{s.binding, b.Revision, sorted}
	raw, _ := json.Marshal(core)
	return b, sha256.Sum256(raw), nil
}
func (s *Store) Accept(raw []byte, now time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	var e Envelope
	if strictJSON(raw, &e) != nil {
		return s.block(ErrInvalid)
	}
	b, fp, err := s.verify(e, now.UnixMilli(), true)
	if err != nil {
		return s.block(err)
	}
	if b.Revision < s.body.Revision || (b.Revision == s.body.Revision && (fp != s.fingerprint || b.IssuedAt < s.body.IssuedAt)) {
		return s.block(ErrRollback)
	}
	if err := persist(s.path, diskState{Envelope: e}); err != nil {
		// Keep the observed signed revision as a memory floor even if storage
		// failed. A subsequent pull cannot restore an older keyset in-process.
		s.envelope = e
		s.body = b
		s.fingerprint = fp
		s.ready = false
		s.failure = ErrStorage
		return ErrStorage
	}
	s.envelope = e
	s.body = b
	s.fingerprint = fp
	s.ready = true
	s.failure = nil
	return nil
}

// Reject invalid transport/authentication responses without logging their body.
func (s *Store) Reject() { s.mu.Lock(); defer s.mu.Unlock(); _ = s.block(ErrInvalid) }
func (s *Store) block(cause error) error {
	s.ready = false
	s.failure = cause
	if s.body.Revision != 0 {
		if err := persist(s.path, diskState{Envelope: s.envelope, Blocked: true}); err != nil {
			s.failure = ErrStorage
			return ErrStorage
		}
	}
	return cause
}
func (s *Store) VerificationKey(kid string, now time.Time) (ed25519.PublicKey, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	ms := now.UnixMilli()
	if !s.ready || ms < s.body.IssuedAt-30000 || ms >= s.body.ExpiresAt {
		return nil, ErrUnavailable
	}
	for _, key := range s.body.Keys {
		if key.KID == kid && key.Status == "active" && ms >= key.NotBefore && ms < key.NotAfter {
			raw, _ := base64.RawURLEncoding.DecodeString(key.PublicKey)
			return ed25519.PublicKey(raw), nil
		}
	}
	return nil, ErrUnavailable
}
func persist(path string, state diskState) error {
	raw, err := json.Marshal(state)
	if err != nil {
		return err
	}
	dir := filepath.Dir(path)
	if err = os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	file, err := os.CreateTemp(dir, ".gateway-keyset-*")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	if err = file.Chmod(0600); err == nil {
		_, err = file.Write(raw)
	}
	if err == nil {
		err = file.Sync()
	}
	closeErr := file.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		return err
	}
	if err = os.Rename(file.Name(), path); err != nil {
		return err
	}
	directory, err := os.Open(dir)
	if err != nil {
		return err
	}
	defer directory.Close()
	return directory.Sync()
}

// Reject duplicate members as well as unknown fields and trailing JSON values.
func strictJSON(raw []byte, dest any) error {
	if len(raw) > 65536 {
		return ErrInvalid
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	if err := uniqueValue(d); err != nil {
		return err
	}
	if _, err := d.Token(); err != io.EOF {
		return ErrInvalid
	}
	d = json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if err := d.Decode(dest); err != nil {
		return ErrInvalid
	}
	return nil
}
func uniqueValue(d *json.Decoder) error {
	token, err := d.Token()
	if err != nil {
		return ErrInvalid
	}
	delim, ok := token.(json.Delim)
	if !ok {
		return nil
	}
	switch delim {
	case '{':
		seen := map[string]bool{}
		for d.More() {
			t, err := d.Token()
			key, ok := t.(string)
			if err != nil || !ok || seen[key] {
				return ErrInvalid
			}
			seen[key] = true
			if err := uniqueValue(d); err != nil {
				return err
			}
		}
		t, err := d.Token()
		if err != nil || t != json.Delim('}') {
			return ErrInvalid
		}
	case '[':
		for d.More() {
			if err := uniqueValue(d); err != nil {
				return err
			}
		}
		t, err := d.Token()
		if err != nil || t != json.Delim(']') {
			return ErrInvalid
		}
	default:
		return fmt.Errorf("gateway_keyset_json_invalid")
	}
	return nil
}

// Unavailable is a retryable absence, unlike invalid signatures or rollback.
func (s *Store) Unavailable() { s.mu.Lock(); defer s.mu.Unlock(); s.ready = false }
