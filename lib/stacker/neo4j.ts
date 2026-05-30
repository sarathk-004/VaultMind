import neo4j, { type Driver } from "neo4j-driver"
import type { GraphEdge, GraphNode, KnowledgeGraph } from "@/lib/vaultmind-types"
import type { StackerGraphAdapter } from "./types"

let driver: Driver | null = null

function getDriver(): Driver {
  if (!process.env.NEO4J_URI) throw new Error("NEO4J_URI is required for the Neo4j adapter")
  if (!driver) {
    driver = neo4j.driver(
      process.env.NEO4J_URI,
      neo4j.auth.basic(
        process.env.NEO4J_USER ?? "neo4j",
        process.env.NEO4J_PASSWORD ?? "",
      ),
    )
  }
  return driver
}

function edgeType(relation?: string): string {
  const normalized = (relation ?? "LINKED")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
  return normalized || "LINKED"
}

export const neo4jGraphAdapter: StackerGraphAdapter = {
  async upsertNodes(userKey: string, nodes: GraphNode[]) {
    if (nodes.length === 0) return
    const session = getDriver().session()
    try {
      await session.executeWrite(tx =>
        tx.run(
          `
          UNWIND $nodes AS node
          MERGE (n:StackerNode {userKey: $userKey, id: node.id})
          SET n.label = node.label,
              n.type = node.type,
              n.cluster = node.cluster,
              n.updatedAt = datetime()
          `,
          { userKey, nodes },
        ),
      )
    } finally {
      await session.close()
    }
  },

  async upsertEdges(userKey: string, edges: GraphEdge[]) {
    if (edges.length === 0) return
    const session = getDriver().session()
    try {
      await session.executeWrite(async tx => {
        for (const edge of edges) {
          await tx.run(
            `
            MATCH (from:StackerNode {userKey: $userKey, id: $from})
            MATCH (to:StackerNode {userKey: $userKey, id: $to})
            MERGE (from)-[r:${edgeType(edge.relation)} {userKey: $userKey}]->(to)
            SET r.relation = $relation,
                r.updatedAt = datetime()
            `,
            {
              userKey,
              from: edge.from,
              to: edge.to,
              relation: edge.relation ?? "linked",
            },
          )
        }
      })
    } finally {
      await session.close()
    }
  },

  async expand(userKey: string, seedIds: string[], limit: number): Promise<KnowledgeGraph> {
    if (seedIds.length === 0) return { nodes: [], edges: [] }
    const session = getDriver().session()
    try {
      const result = await session.executeRead(tx =>
        tx.run(
          `
          MATCH (seed:StackerNode {userKey: $userKey})
          WHERE seed.id IN $seedIds
          OPTIONAL MATCH (seed)-[r]-(neighbor:StackerNode {userKey: $userKey})
          WITH collect(DISTINCT seed) + collect(DISTINCT neighbor) AS rawNodes,
               collect(DISTINCT r) AS rels
          WITH [n IN rawNodes WHERE n IS NOT NULL][..$limit] AS nodes, rels
          UNWIND nodes AS n
          WITH collect(DISTINCT n) AS nodes, rels
          WITH nodes, [n IN nodes | n.id] AS nodeIds, rels
          RETURN nodes,
            [r IN rels
              WHERE r IS NOT NULL
                AND startNode(r).id IN nodeIds
                AND endNode(r).id IN nodeIds
              | {
                from: startNode(r).id,
                to: endNode(r).id,
                relation: coalesce(r.relation, type(r))
              }
            ] AS edges
          `,
          { userKey, seedIds, limit: neo4j.int(limit) },
        ),
      )
      const record = result.records[0]
      if (!record) return { nodes: [], edges: [] }
      const nodes = (record.get("nodes") as any[]).map(node => {
        const props = node.properties
        return {
          id: props.id,
          label: props.label,
          type: props.type,
          cluster: props.cluster ?? undefined,
        } satisfies GraphNode
      })
      const edges = (record.get("edges") as any[]).map(edge => ({
        from: edge.from,
        to: edge.to,
        relation: edge.relation,
      }))
      return { nodes, edges }
    } finally {
      await session.close()
    }
  },
}
