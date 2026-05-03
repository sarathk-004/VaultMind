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
// Wider repulsion radius so unrelated nodes have visible breathing room.
// Edges are what bring linked pages back together.
const MIN_SEPARATION = 300
const COLLISION_PADDING = 36

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
  const innerRadius = multiClusters.length > 1 ? minSize * 0.22 : 0
  const outerRadius = minSize * 0.46
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
    const localR = isSingleton ? 30 + rand() * 30 : 50 + rand() * 40
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

  // TUNED PHYSICS:
  // Weaken springs & repulsion slightly, and increase damping to bleed kinetic energy.
  const repulsionStrength = 20000 
  const springStrength = 0.03 // Lowered significantly so nodes aren't crushed together
  const centerStrength = 0.001
  const clusterStrength = 0.015
  const damping = 0.65 // Lowered from 0.78 to stop chaotic bouncing
  const sameClusterAttraction = 0.001

  for (let iter = 0; iter < iterations; iter++) {
    const progress = iter / iterations
    
    // NEW COOLING: Drops all the way to 0 so the graph 'freezes' nicely at the end
    const cooling = Math.max(0, 1 - Math.pow(progress, 1.2))

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

    for (let i = 0; i < sim.length; i++) {
      for (let j = i + 1; j < sim.length; j++) {
        const a = sim[i]
        const b = sim[j]
        let dx = b.x - a.x
        let dy = b.y - a.y
        let distSq = dx * dx + dy * dy
        if (distSq < 10) { 
          dx = (rand() - 0.5) * 2
          dy = (rand() - 0.5) * 2
          distSq = dx * dx + dy * dy
        }
        const dist = Math.sqrt(distSq)
        const sameCluster = a.cluster === b.cluster
        if (dist < MIN_SEPARATION) {
          const strength = sameCluster ? repulsionStrength * 0.45 : repulsionStrength
          const force = (strength / (distSq + 100)) * cooling
          const fx = (dx / dist) * force
          const fy = (dy / dist) * force
          a.vx -= fx
          a.vy -= fy
          b.vx += fx
          b.vy += fy
        }
        if (sameCluster && dist > 80) {
          const fx = (dx / dist) * dist * sameClusterAttraction * cooling
          const fy = (dy / dist) * dist * sameClusterAttraction * cooling
          a.vx += fx
          a.vy += fy
          b.vx -= fx
          b.vy -= fy
        }
      }
    }

    // NEW COLLISION LOGIC: Positional nudges instead of explosive velocities
    for (let i = 0; i < sim.length; i++) {
      for (let j = i + 1; j < sim.length; j++) {
        const a = sim[i]
        const b = sim[j]
        const dx = b.x - a.x
        const dy = b.y - a.y
        const halfW = NODE_WIDTH / 2 + COLLISION_PADDING / 2
        const halfH = NODE_HEIGHT / 2 + COLLISION_PADDING / 2
        const overlapX = halfW - Math.abs(dx)
        const overlapY = halfH - Math.abs(dy)
        
        if (overlapX > 0 && overlapY > 0) {
          // Push stays active even at low cooling to guarantee rigid non-overlap
          const pushStrength = 0.5 * Math.max(0.1, cooling) 
          
          if (overlapX < overlapY) {
            const push = (overlapX * pushStrength) / 2
            const dir = Math.sign(dx) || 1
            a.x -= push * dir
            b.x += push * dir
            a.vx *= 0.5 // damp axis velocity to prevent jitter
            b.vx *= 0.5
          } else {
            const push = (overlapY * pushStrength) / 2
            const dir = Math.sign(dy) || 1
            a.y -= push * dir
            b.y += push * dir
            a.vy *= 0.5
            b.vy *= 0.5
          }
        }
      }
    }

    const edgeLength = 250 // Give dense edges a bit more breathing room
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

    for (const n of sim) {
      const c = centroids.get(n.cluster ?? n.id)
      if (c) {
        n.vx += (c.x - n.x) * clusterStrength * cooling // Apply cooling here too!
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
  page: { fill: "rgba(59, 130, 246, 0.18)", stroke: "#3b82f6", text: "#bfdbfe" },
  database: { fill: "rgba(168, 85, 247, 0.18)", stroke: "#a855f7", text: "#e9d5ff" },
  task: { fill: "rgba(34, 197, 94, 0.18)", stroke: "#22c55e", text: "#bbf7d0" },
  note: { fill: "rgba(245, 158, 11, 0.18)", stroke: "#f59e0b", text: "#fde68a" },
}

export function getNodeColor(type?: string) {
  return NODE_TYPE_COLORS[type || "page"] || NODE_TYPE_COLORS.page
}
