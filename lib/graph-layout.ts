import type { GraphNode, GraphEdge } from "./vaultmind-types"

export interface PositionedNode extends GraphNode {
  x: number
  y: number
}

interface SimNode {
  id: string
  label: string
  type?: string
  cluster?: string
  x: number
  y: number
  vx: number
  vy: number
}

const NODE_WIDTH = 140
const NODE_HEIGHT = 40
// Keep unrelated nodes readable without letting sparse pages drift too far.
const MIN_SEPARATION = 220
const COLLISION_PADDING = 24

function seededRandom(seed: string) {
  let h = 0
  for (let i = 0; i < seed.length; i++) {
    h = (h << 5) - h + seed.charCodeAt(i)
    h |= 0
  }
  return () => {
    h = (h * 9301 + 49297) % 233280
    return h / 233280
  }
}

/**
 * Force-directed layout with cluster-aware grouping.
 *
 *   - Initial: nodes sharing a cluster start near a shared anchor point on a
 *     ring around the canvas, so groups land in different regions.
 *   - Repulsion: pair-wise within a min-separation radius.
 *   - Cluster gravity: each node is pulled toward its cluster centroid (mild).
 *   - Edges: spring forces along graph edges.
 *   - Collision pass: rectangle overlap resolution.
 */
// Add this helper function above simulateLayout

export function simulateLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
  width: number,
  height: number,
  iterations = 700,
): PositionedNode[] {
  if (nodes.length === 0) return []

  const seedKey = nodes.map(n => n.id).join("|")
  const rand = seededRandom(seedKey)

  const cx = width / 2
  const cy = height / 2

  const clusterSize = new Map<string, number>()
  for (const n of nodes) {
    const c = n.cluster ?? n.id
    clusterSize.set(c, (clusterSize.get(c) ?? 0) + 1)
  }
  const multiClusters = Array.from(clusterSize.keys())
    .filter(c => (clusterSize.get(c) ?? 0) > 1)
    .sort((a, b) => (clusterSize.get(b) ?? 0) - (clusterSize.get(a) ?? 0))
  const singletonClusters = Array.from(clusterSize.keys()).filter(
    c => (clusterSize.get(c) ?? 0) === 1,
  )

  const minSize = Math.min(width, height)
  // Spread them out much wider initially so they don't start in a pile
  const innerRadius = multiClusters.length > 1 ? minSize * 0.28 : 0
  const outerRadius = minSize * 0.42
  const anchors = new Map<string, { x: number; y: number }>()

  multiClusters.forEach((c, i) => {
    if (multiClusters.length === 1) {
      anchors.set(c, { x: cx, y: cy })
      return
    }
    const angle = (i / multiClusters.length) * Math.PI * 2
    anchors.set(c, {
      x: cx + Math.cos(angle) * innerRadius,
      y: cy + Math.sin(angle) * innerRadius,
    })
  })
  singletonClusters.forEach((c, i) => {
    const angle = (i / Math.max(singletonClusters.length, 1)) * Math.PI * 2
    anchors.set(c, {
      x: cx + Math.cos(angle) * outerRadius,
      y: cy + Math.sin(angle) * outerRadius,
    })
  })

  const sim: SimNode[] = nodes.map(n => {
    const cluster = n.cluster ?? n.id
    const a = anchors.get(cluster)!
    const isSingleton = (clusterSize.get(cluster) ?? 1) === 1
    // Larger spawn radius per cluster
    const localR = isSingleton ? 70 + rand() * 110 : 40 + rand() * 90
    const localAngle = rand() * Math.PI * 2
    return {
      id: n.id,
      label: n.label,
      type: n.type,
      cluster,
      x: a.x + Math.cos(localAngle) * localR,
      y: a.y + Math.sin(localAngle) * localR,
      vx: 0,
      vy: 0,
    }
  })

  const idIndex = new Map(sim.map((n, i) => [n.id, i]))
  const validEdges = edges.filter(e => idIndex.has(e.from) && idIndex.has(e.to))

  // Rebalanced physics: high repulsion, gentle springs, weak gravity
  const repulsionStrength = 26000 
  const springStrength = 0.065 
  const centerStrength = 0.0012
  const clusterStrength = 0.008
  const damping = 0.75 

  for (let iter = 0; iter < iterations; iter++) {
    const progress = iter / iterations
    const cooling = Math.max(0, 1 - progress) // Linear cooling down to 0

    const centroids = new Map<string, { x: number; y: number; n: number }>()
    for (const n of sim) {
      const c = n.cluster ?? n.id
      const cur = centroids.get(c)
      if (cur) {
        cur.x += n.x
        cur.y += n.y
        cur.n++
      } else {
        centroids.set(c, { x: n.x, y: n.y, n: 1 })
      }
    }
    for (const v of centroids.values()) {
      v.x /= v.n
      v.y /= v.n
    }

    // 1. Repulsion (Push apart)
    for (let i = 0; i < sim.length; i++) {
      for (let j = i + 1; j < sim.length; j++) {
        const a = sim[i]
        const b = sim[j]
        let dx = b.x - a.x
        let dy = b.y - a.y
        let distSq = dx * dx + dy * dy
        if (distSq < 10) { 
          dx = (rand() - 0.5) * 5
          dy = (rand() - 0.5) * 5
          distSq = dx * dx + dy * dy
        }
        const dist = Math.sqrt(distSq)
        if (dist < MIN_SEPARATION) {
          const force = (repulsionStrength / (distSq + 100)) * cooling
          const fx = (dx / dist) * force
          const fy = (dy / dist) * force
          a.vx -= fx
          a.vy -= fy
          b.vx += fx
          b.vy += fy
        }
      }
    }

    // 2. Collision Resolution (Force-based, no velocity freezing!)
    for (let i = 0; i < sim.length; i++) {
      for (let j = i + 1; j < sim.length; j++) {
        const a = sim[i]
        const b = sim[j]
        const dx = b.x - a.x
        const dy = b.y - a.y
        const overlapX = (NODE_WIDTH + COLLISION_PADDING) - Math.abs(dx)
        const overlapY = (NODE_HEIGHT + COLLISION_PADDING) - Math.abs(dy)
        
        if (overlapX > 0 && overlapY > 0) {
          const pushStrength = 4.0 * cooling 
          if (overlapX < overlapY) {
            const push = overlapX * pushStrength
            const dir = Math.sign(dx) || 1
            a.vx -= push * dir
            b.vx += push * dir
          } else {
            const push = overlapY * pushStrength
            const dir = Math.sign(dy) || 1
            a.vy -= push * dir
            b.vy += push * dir
          }
        }
      }
    }

    // 3. Springs (Pull together)
    const edgeLength = 175
    for (const edge of validEdges) {
      const a = sim[idIndex.get(edge.from)!]
      const b = sim[idIndex.get(edge.to)!]
      const dx = b.x - a.x
      const dy = b.y - a.y
      const dist = Math.sqrt(dx * dx + dy * dy) || 1
      const displacement = dist - edgeLength
      const force = displacement * springStrength * cooling
      const fx = (dx / dist) * force
      const fy = (dy / dist) * force
      a.vx += fx
      a.vy += fy
      b.vx -= fx
      b.vy -= fy
    }

    // 4. Gravity & Velocity Integration
    for (const n of sim) {
      const c = centroids.get(n.cluster ?? n.id)
      if (c) {
        n.vx += (c.x - n.x) * clusterStrength * cooling 
        n.vy += (c.y - n.y) * clusterStrength * cooling
      }
      n.vx += (cx - n.x) * centerStrength * cooling
      n.vy += (cy - n.y) * centerStrength * cooling
      
      n.vx *= damping
      n.vy *= damping
      n.x += n.vx
      n.y += n.vy

      const boundPadding = NODE_WIDTH / 2 + 50
      n.x = Math.max(boundPadding, Math.min(width - boundPadding, n.x))
      n.y = Math.max(boundPadding, Math.min(height - boundPadding, n.y))
    }
  }

  return sim.map(n => ({
    id: n.id,
    label: n.label,
    type: n.type,
    cluster: n.cluster,
    x: n.x,
    y: n.y,
  }))
}

export function buildAdjacency(edges: GraphEdge[]): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>()
  for (const e of edges) {
    if (!adj.has(e.from)) adj.set(e.from, new Set())
    if (!adj.has(e.to)) adj.set(e.to, new Set())
    adj.get(e.from)!.add(e.to)
    adj.get(e.to)!.add(e.from)
  }
  return adj
}

export function truncateLabel(label: string, max = 20): string {
  if (label.length <= max) return label
  return label.slice(0, max - 1) + "…"
}

export const NODE_TYPE_COLORS: Record<string, { fill: string; stroke: string; text: string }> = {
  page: { fill: "var(--node-page-fill)", stroke: "var(--node-page)", text: "var(--node-page-text)" },
  database: { fill: "var(--node-database-fill)", stroke: "var(--node-database)", text: "var(--node-database-text)" },
  task: { fill: "var(--node-task-fill)", stroke: "var(--node-task)", text: "var(--node-task-text)" },
  note: { fill: "var(--node-note-fill)", stroke: "var(--node-note)", text: "var(--node-note-text)" },
}

export function getNodeColor(type?: string) {
  return NODE_TYPE_COLORS[type || "page"] || NODE_TYPE_COLORS.page
}
