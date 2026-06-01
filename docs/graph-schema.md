# Graph Schema + Entity Resolution

This document defines the canonical knowledge graph schema for Graphyne and the
entity resolution policy that turns Notion content into stable, queryable
memory.

## Goals

- Make Notion the source of truth and the graph a derived memory layer.
- Preserve time and provenance for every assertion.
- Support personal memory now, and team memory when content is shared.

## Canonical Node Types

All nodes carry:

- id (stable)
- workspace_id (required)
- label (human-readable)
- type (enum)
- provenance (source + URL + timestamps)
- created_at, updated_at

Node types:

- Document
  - Notion pages, databases, and blocks.
- Entity
  - People, projects, teams, products, concepts, topics.
- Task
  - Action items, assignments, work items.
- Event
  - Time-bound entries (meetings, releases, deadlines).
- Fact
  - Atomic assertions with temporal validity.

## Canonical Edge Types

All edges carry:

- workspace_id (required)
- from_id, to_id
- relation (enum)
- confidence (0..1)
- valid_from, valid_to (temporal bounds)
- provenance (source + URL)

Edge relations:

- contains (Document -> Document)
- references (Document -> Document)
- mentions (Document -> Entity)
- assigned_to (Task -> Entity)
- authored_by (Document -> Entity)
- related_to (Entity -> Entity)
- contradicts (Fact -> Fact)
- supersedes (Fact -> Fact)

## Memory Layers

- Document Memory: raw Notion content and metadata.
- Entity Memory: merged entities with aliases and references.
- Temporal Knowledge Memory: time-bounded facts with provenance.

## Entity Resolution Policy

1. Normalize
   - Lowercase, strip punctuation, normalize whitespace.
   - Apply alias table if present.

2. Candidate Selection
   - Same workspace only.
   - Same entity type only.
   - Name similarity above threshold (Jaccard + edit distance).

3. Merge Rules
   - Merge if confidence >= 0.85 and provenance is compatible.
   - Do not merge if conflicts on core attributes (role, org, project).

4. Split Rules
   - If new evidence contradicts core attributes, split into a new entity
     version and link with a disambiguation edge.

5. Temporal Invalidations
   - When a fact changes, store a new assertion and invalidate the old one
     with valid_to.
   - Never overwrite facts in place.

## Conflict Handling

- Keep versions of facts with explicit valid_from/valid_to.
- Rank current truth by recency and provenance trust.
- If unresolved, return multiple assertions with dates.

## Workspace Isolation

- Every record in storage must include workspace_id.
- Queries must filter by workspace_id before any joins.

## Notes

- The graph is derived memory; Notion remains the source of truth.
- The LLM is a reasoning layer, not a source of record.
