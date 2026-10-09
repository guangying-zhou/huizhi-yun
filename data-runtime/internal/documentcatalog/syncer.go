package documentcatalog

import (
	"sort"
	"sync"
	"sync/atomic"
)

// Syncer runs catalog reconciles for post-commit triggers on one background
// worker. Triggers never block the caller: they are merged per kind into a
// bounded pending set and executed serially. When the set is full further
// requests are dropped and counted; the reconcile command repairs any gap.
type Syncer struct {
	run     func(kind string, filter Filter)
	max     int
	mu      sync.Mutex
	pending map[string]*pendingSync
	order   []string
	wake    chan struct{}
	dropped atomic.Int64
	started bool
}

type pendingSync struct {
	all    bool
	ids    map[string]bool
	owners map[[2]string]bool
}

func (p *pendingSync) size() int { return len(p.ids) + len(p.owners) }

// NewSyncer creates a syncer that merges at most max objects or owners per
// kind. run is called on the worker goroutine, one request at a time.
func NewSyncer(max int, run func(kind string, filter Filter)) *Syncer {
	if max < 1 {
		max = 1
	}
	return &Syncer{run: run, max: max, pending: map[string]*pendingSync{}, wake: make(chan struct{}, 1)}
}

// Dropped reports how many trigger requests were discarded because the
// pending set was full.
func (s *Syncer) Dropped() int64 { return s.dropped.Load() }

// Trigger records that kind needs a reconcile for filter and returns
// immediately. An empty filter means the whole kind and absorbs targeted
// requests for the same kind.
func (s *Syncer) Trigger(kind string, filter Filter) {
	if s == nil || s.run == nil {
		return
	}
	s.mu.Lock()
	p, exists := s.pending[kind]
	if !exists {
		p = &pendingSync{ids: map[string]bool{}, owners: map[[2]string]bool{}}
		s.pending[kind] = p
		s.order = append(s.order, kind)
	}
	switch {
	case p.all:
	case len(filter.ObjectIDs) == 0 && filter.OwnerCode == "":
		p.all, p.ids, p.owners = true, map[string]bool{}, map[[2]string]bool{}
	default:
		if filter.OwnerCode != "" {
			key := [2]string{filter.OwnerType, filter.OwnerCode}
			if !p.owners[key] {
				if p.size() >= s.max {
					s.dropped.Add(1)
				} else {
					p.owners[key] = true
				}
			}
		}
		for _, id := range filter.ObjectIDs {
			if p.ids[id] {
				continue
			}
			if p.size() >= s.max {
				s.dropped.Add(1)
				continue
			}
			p.ids[id] = true
		}
	}
	if !s.started {
		s.started = true
		go s.work()
	}
	s.mu.Unlock()
	select {
	case s.wake <- struct{}{}:
	default:
	}
}

func (s *Syncer) work() {
	for range s.wake {
		for {
			s.mu.Lock()
			if len(s.order) == 0 {
				s.mu.Unlock()
				break
			}
			kind := s.order[0]
			s.order = s.order[1:]
			p := s.pending[kind]
			delete(s.pending, kind)
			s.mu.Unlock()
			if p.all {
				s.run(kind, Filter{})
				continue
			}
			owners := make([][2]string, 0, len(p.owners))
			for owner := range p.owners {
				owners = append(owners, owner)
			}
			sort.Slice(owners, func(i, j int) bool { return owners[i][0]+owners[i][1] < owners[j][0]+owners[j][1] })
			for _, owner := range owners {
				s.run(kind, Filter{OwnerType: owner[0], OwnerCode: owner[1]})
			}
			if len(p.ids) > 0 {
				ids := make([]string, 0, len(p.ids))
				for id := range p.ids {
					ids = append(ids, id)
				}
				sort.Strings(ids)
				s.run(kind, Filter{ObjectIDs: ids})
			}
		}
	}
}
