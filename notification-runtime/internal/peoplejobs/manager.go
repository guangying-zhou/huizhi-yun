package peoplejobs

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"sort"
	"strings"
	"sync"
	"time"
)

var (
	ErrJobNotFound         = errors.New("people sync job was not found")
	ErrJobNotCancellable   = errors.New("people sync job is not pending or running")
	ErrJobNotRetryable     = errors.New("people sync job is not failed")
	ErrIdempotencyConflict = errors.New("idempotency key was already used for a different request")
	ErrJobAlreadyRunning   = errors.New("another people sync job is already pending or running")
	ErrStaleRevision       = errors.New("people sync watermark is older than the latest accepted job")
)

type Manager struct {
	store   *Store
	runner  Runner
	sink    Sink
	mu      sync.Mutex
	cancels map[string]context.CancelFunc
}

func NewManager(store *Store, runner Runner, sink Sink) *Manager {
	return &Manager{store: store, runner: runner, sink: sink, cancels: map[string]context.CancelFunc{}}
}

func (m *Manager) Start(ctx context.Context, input StartRequest) (Job, bool, error) {
	return m.start(ctx, input, "")
}

func (m *Manager) start(ctx context.Context, input StartRequest, retryOfJobID string) (Job, bool, error) {
	input.Provider = strings.ToLower(strings.TrimSpace(input.Provider))
	if input.Provider == "" {
		input.Provider = "dingtalk"
	}
	if input.Provider != "dingtalk" {
		return Job{}, false, errors.New("people sync provider must be dingtalk")
	}
	input.IntegrationCode = strings.TrimSpace(input.IntegrationCode)
	if input.IntegrationCode == "" {
		input.IntegrationCode = "dingtalk.default"
	}
	if input.IntegrationCode != "dingtalk.default" {
		return Job{}, false, errors.New("people sync integrationCode must be dingtalk.default")
	}
	input.IdempotencyKey = strings.TrimSpace(input.IdempotencyKey)
	if len(input.IdempotencyKey) < 16 || len(input.IdempotencyKey) > 128 {
		return Job{}, false, errors.New("idempotencyKey must contain 16 to 128 characters")
	}
	input.OriginalActorUID = strings.TrimSpace(input.OriginalActorUID)
	if len(input.OriginalActorUID) > 128 || strings.ContainsAny(input.OriginalActorUID, "\r\n\x00") {
		return Job{}, false, errors.New("originalActorUid is invalid")
	}
	input.ObjectScopes = normalizeScopes(input.ObjectScopes)
	if len(input.ObjectScopes) == 0 {
		input.ObjectScopes = []string{"organization", "people"}
	}
	for _, scope := range input.ObjectScopes {
		if scope != "organization" && scope != "people" && scope != "directory_profiles" {
			return Job{}, false, errors.New("objectScopes may contain only organization, people, and directory_profiles")
		}
	}
	if input.Watermark != "" {
		parsedWatermark, parseErr := time.Parse(time.RFC3339Nano, input.Watermark)
		if parseErr != nil {
			return Job{}, false, errors.New("watermark must be an RFC3339 timestamp")
		}
		input.Watermark = parsedWatermark.UTC().Format(time.RFC3339Nano)
	}
	requestHash := peopleSyncRequestHash(input, retryOfJobID)
	if input.Watermark == "" {
		input.Watermark = time.Now().UTC().Format(time.RFC3339Nano)
	}
	job := Job{JobID: newJobID(), RetryOfJobID: retryOfJobID, OriginalActorUID: input.OriginalActorUID, Provider: input.Provider, IntegrationCode: input.IntegrationCode, ObjectScopes: input.ObjectScopes, Watermark: input.Watermark}
	created, wasCreated, err := m.store.Create(ctx, job, input.IdempotencyKey, requestHash)
	if err != nil {
		return Job{}, false, err
	}
	if !wasCreated {
		return created, false, nil
	}
	go m.run(job.JobID, input)
	return created, true, nil
}

func (m *Manager) Get(ctx context.Context, id string) (Job, bool, error) {
	return m.store.Get(ctx, strings.TrimSpace(id))
}

func (m *Manager) Cancel(ctx context.Context, id string) (Job, error) {
	id = strings.TrimSpace(id)
	previous, ok, err := m.store.Get(ctx, id)
	if err != nil {
		return Job{}, err
	}
	if !ok {
		return Job{}, ErrJobNotFound
	}
	return m.CancelAs(ctx, id, previous.OriginalActorUID, "people-sync-cancel:"+id)
}

func (m *Manager) CancelAs(ctx context.Context, id, originalActorUID, idempotencyKey string) (Job, error) {
	id = strings.TrimSpace(id)
	originalActorUID = strings.TrimSpace(originalActorUID)
	idempotencyKey = strings.TrimSpace(idempotencyKey)
	if idempotencyKey == "" {
		idempotencyKey = "people-sync-cancel:" + id
	}
	if len(originalActorUID) > 128 || strings.ContainsAny(originalActorUID, "\r\n\x00") {
		return Job{}, errors.New("originalActorUid is invalid")
	}
	if len(idempotencyKey) < 16 || len(idempotencyKey) > 128 {
		return Job{}, errors.New("idempotencyKey must contain 16 to 128 characters")
	}
	requestHash := hashJSON(struct {
		Action           string `json:"action"`
		JobID            string `json:"jobId"`
		OriginalActorUID string `json:"originalActorUid"`
	}{Action: "cancel", JobID: id, OriginalActorUID: originalActorUID})
	job, changed, err := m.store.CancelAs(ctx, id, originalActorUID, idempotencyKey, requestHash)
	if err != nil {
		return Job{}, err
	}
	if job.JobID == "" {
		return Job{}, ErrJobNotFound
	}
	if !changed {
		if job.Status == "cancelled" {
			return job, nil
		}
		return Job{}, ErrJobNotCancellable
	}
	m.mu.Lock()
	cancel := m.cancels[id]
	m.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	return job, nil
}

func (m *Manager) Retry(ctx context.Context, id string) (Job, bool, error) {
	return m.RetryAs(ctx, id, "", "")
}

func (m *Manager) RetryAs(ctx context.Context, id, originalActorUID, idempotencyKey string) (Job, bool, error) {
	id = strings.TrimSpace(id)
	previous, ok, err := m.store.Get(ctx, id)
	if err != nil {
		return Job{}, false, err
	}
	if !ok {
		return Job{}, false, ErrJobNotFound
	}
	if previous.Status != "failed" {
		return Job{}, false, ErrJobNotRetryable
	}
	if strings.TrimSpace(idempotencyKey) == "" {
		idempotencyKey = "people-sync-retry:" + previous.JobID
	}
	if strings.TrimSpace(originalActorUID) == "" {
		originalActorUID = previous.OriginalActorUID
	}
	return m.start(ctx, StartRequest{
		Provider:         previous.Provider,
		IntegrationCode:  previous.IntegrationCode,
		ObjectScopes:     previous.ObjectScopes,
		Watermark:        previous.Watermark,
		IdempotencyKey:   idempotencyKey,
		OriginalActorUID: originalActorUID,
	}, previous.JobID)
}

func (m *Manager) run(id string, input StartRequest) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	m.mu.Lock()
	m.cancels[id] = cancel
	m.mu.Unlock()
	defer func() {
		cancel()
		m.mu.Lock()
		delete(m.cancels, id)
		m.mu.Unlock()
	}()
	if err := m.store.Start(ctx, id); err != nil {
		return
	}
	var sinkCounts Counts
	counts, err := m.runner.RunPeopleSync(ctx, input, func(batch Batch) error {
		batch.JobID = id
		batch.Provider = input.Provider
		batch.IntegrationCode = input.IntegrationCode
		batch.ObjectScopes = input.ObjectScopes
		batch.Watermark = input.Watermark
		applied, err := m.sink.Apply(ctx, batch)
		if err == nil {
			sinkCounts.Applied += applied.Applied
			sinkCounts.Skipped += applied.Skipped
		}
		return err
	})
	if err != nil {
		if failureSink, ok := m.sink.(FailureSink); ok {
			_ = failureSink.Fail(context.Background(), Batch{
				JobID:           id,
				Provider:        input.Provider,
				IntegrationCode: input.IntegrationCode,
				ObjectScopes:    input.ObjectScopes,
				Watermark:       input.Watermark,
			}, "directory_profile_sync_failed", err.Error())
		}
		_ = m.store.Fail(context.Background(), id, "people_sync_failed", err.Error())
		return
	}
	counts.Applied = sinkCounts.Applied
	counts.Skipped = sinkCounts.Skipped
	_ = m.store.Complete(context.Background(), id, counts)
}

func normalizeScopes(input []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, v := range input {
		v = strings.ToLower(strings.TrimSpace(v))
		if v != "" && !seen[v] {
			seen[v] = true
			out = append(out, v)
		}
	}
	sort.Strings(out)
	return out
}

func peopleSyncRequestHash(input StartRequest, retryOfJobID string) string {
	return hashJSON(struct {
		Provider         string   `json:"provider"`
		IntegrationCode  string   `json:"integrationCode"`
		ObjectScopes     []string `json:"objectScopes"`
		Watermark        string   `json:"watermark"`
		OriginalActorUID string   `json:"originalActorUid"`
		RetryOfJobID     string   `json:"retryOfJobId"`
	}{input.Provider, input.IntegrationCode, input.ObjectScopes, input.Watermark, input.OriginalActorUID, retryOfJobID})
}

func hashJSON(value any) string {
	payload, _ := json.Marshal(value)
	sum := sha256.Sum256(payload)
	return hex.EncodeToString(sum[:])
}
func newJobID() string {
	b := make([]byte, 18)
	_, _ = rand.Read(b)
	return "crj_" + base64.RawURLEncoding.EncodeToString(b)
}
