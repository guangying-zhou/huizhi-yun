package peoplejobs

import (
	"context"
	"errors"
	"strings"

	consoleclient "github.com/huizhi-yun/notification-runtime/internal/console"
)

type ScopedSink struct {
	people    Sink
	directory Sink
}

func NewScopedSink(people Sink, directory Sink) *ScopedSink {
	return &ScopedSink{people: people, directory: directory}
}

func (s *ScopedSink) Apply(ctx context.Context, batch Batch) (Counts, error) {
	var result Counts
	hasPeople := hasScope(batch.ObjectScopes, "people") || hasScope(batch.ObjectScopes, "organization")
	hasDirectory := hasScope(batch.ObjectScopes, "directory_profiles")
	if hasPeople {
		if s.people == nil {
			return Counts{}, errors.New("data-runtime People sink is unavailable")
		}
		peopleResult, err := s.people.Apply(ctx, batch)
		if err != nil {
			return Counts{}, err
		}
		result = peopleResult
	}
	if hasDirectory {
		if s.directory == nil {
			return Counts{}, errors.New("Console directory profile sink is unavailable")
		}
		directoryResult, err := s.directory.Apply(ctx, batch)
		if err != nil {
			return Counts{}, err
		}
		if !hasPeople {
			result = directoryResult
		}
	}
	if !hasPeople && !hasDirectory {
		return Counts{}, errors.New("People sync batch has no supported object scope")
	}
	return result, nil
}

func (s *ScopedSink) Fail(ctx context.Context, batch Batch, code, message string) error {
	if !hasScope(batch.ObjectScopes, "directory_profiles") {
		return nil
	}
	failureSink, ok := s.directory.(FailureSink)
	if !ok {
		return errors.New("Console directory profile failure sink is unavailable")
	}
	return failureSink.Fail(ctx, batch, code, message)
}

func hasScope(scopes []string, wanted string) bool {
	for _, scope := range scopes {
		if strings.EqualFold(strings.TrimSpace(scope), wanted) {
			return true
		}
	}
	return false
}

type ConsoleDirectoryProfileSink struct {
	client *consoleclient.Client
}

func NewConsoleDirectoryProfileSink(client *consoleclient.Client) *ConsoleDirectoryProfileSink {
	return &ConsoleDirectoryProfileSink{client: client}
}

func (s *ConsoleDirectoryProfileSink) Apply(ctx context.Context, batch Batch) (Counts, error) {
	users := make([]consoleclient.DirectoryProfileUser, 0, len(batch.Users))
	for _, user := range batch.Users {
		users = append(users, consoleclient.DirectoryProfileUser{
			ProviderSubject: user.ProviderSubject,
			Email:           user.Email,
			Name:            user.Name,
		})
	}
	result, err := s.client.SyncDirectoryProfiles(ctx, consoleclient.DirectoryProfileBatch{
		JobID:           batch.JobID,
		BatchNumber:     batch.BatchNumber,
		Final:           batch.Final,
		Provider:        batch.Provider,
		IntegrationCode: batch.IntegrationCode,
		Watermark:       batch.Watermark,
		Users:           users,
	})
	if err != nil {
		return Counts{}, err
	}
	return Counts{Applied: result.Updated, Skipped: result.Skipped}, nil
}

func (s *ConsoleDirectoryProfileSink) Fail(ctx context.Context, batch Batch, code, message string) error {
	return s.client.FailDirectoryProfileSync(ctx, consoleclient.DirectoryProfileFailure{
		JobID:           batch.JobID,
		Provider:        batch.Provider,
		IntegrationCode: batch.IntegrationCode,
		Watermark:       batch.Watermark,
		ErrorCode:       code,
		ErrorMessage:    message,
	})
}
