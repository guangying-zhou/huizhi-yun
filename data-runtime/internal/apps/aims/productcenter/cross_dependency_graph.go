package productcenter

import (
	"context"
	"database/sql"
	"strconv"
)

// Acquire before product locks in every dependency mutation. No graph data is
// returned to callers: authorization of each visible endpoint remains separate.
func lockProductDependencyGraph(ctx context.Context, tx *sql.Tx) (uint64, error) {
	var revision uint64
	err := tx.QueryRowContext(ctx, `SELECT revision FROM product_dependency_graph_lock WHERE id=1 FOR UPDATE`).Scan(&revision)
	return revision, err
}

// Includes both edge types; item IDs are globally unique within the tenant DB.
// Limit failures never validate a truncated graph.
func loadUnifiedDependencyGraph(ctx context.Context, tx *sql.Tx) (map[string][]string, error) {
	graph := map[string][]string{}
	rows, err := tx.QueryContext(ctx, `SELECT id FROM product_planning_items ORDER BY id LIMIT 100001`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var id int64
		if err = rows.Scan(&id); err != nil {
			rows.Close()
			return nil, err
		}
		graph[strconv.FormatInt(id, 10)] = []string{}
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	if len(graph) > 100000 {
		return nil, invalid("planning_dependency_limit", "依赖图超过支持上限")
	}
	rows, err = tx.QueryContext(ctx, `SELECT planning_item_id,predecessor_id FROM product_planning_dependencies UNION ALL SELECT planning_item_id,predecessor_id FROM product_cross_dependencies LIMIT 1000001`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	count := 0
	for rows.Next() {
		var from, to int64
		if err = rows.Scan(&from, &to); err != nil {
			return nil, err
		}
		count++
		if count > 1000000 {
			return nil, invalid("planning_dependency_limit", "依赖图超过支持上限")
		}
		source, target := strconv.FormatInt(from, 10), strconv.FormatInt(to, 10)
		if _, ok := graph[source]; !ok {
			return nil, invalid("planning_dependency_not_found", "依赖端点不存在")
		}
		if _, ok := graph[target]; !ok {
			return nil, invalid("planning_dependency_not_found", "依赖端点不存在")
		}
		graph[source] = append(graph[source], target)
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	return graph, nil
}
