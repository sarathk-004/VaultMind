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
  iterations = 800,
): PositionedNode[] {
  if (nodes.length === 0) return []

  const seedKey = nodes.map(n => n.id).join("|")
  const rand = seededRandom(seedKey)

  const cx = width / 2
  const cy = height / 2

  // ── Phase 1: cluster detection via edge connectivity ──────────────────
  // Build connected components — nodes with no edges get their own cluster
  const adjMap = new Map<string, Set<string>>()
  for (const n of nodes) adjMap.set(n.id, new Set())
  for (const e of edges) {
    adjMap.get(e.from)?.add(e.to)
    adjMap.get(e.to)?.add(e.from)
  }

  const visited = new Set<string>()
  const componentOf = new Map<string, string>()
  let componentCount = 0

  for (const n of nodes) {
    if (visited.has(n.id)) continue
    const root = n.id
    const queue = [n.id]
    visited.add(n.id)
    while (queue.length) {
      const cur = queue.shift()!
      componentOf.set(cur, root)
      for (const neighbor of adjMap.get(cur) ?? []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor)
          queue.push(neighbor)
        }
      }
    }
    componentCount++
  }

  // ── Phase 2: assign cluster anchors in a grid, not a ring ─────────────
  // Grid is far more stable than ring for 10+ clusters
  const components = Array.from(new Set(componentOf.values()))
  const cols = Math.ceil(Math.sqrt(components.length * 1.5))
  const cellW = (width  - 120) / cols
  const cellH = (height - 120) / Math.ceil(components.length / cols)

  const anchors = new Map<string, { x: number; y: number }>()
  components.forEach((cId, i) => {
    const col = i % cols
    const row = Math.floor(i / cols)
    anchors.set(cId, {
      x: 60 + col * cellW + cellW / 2,
      y: 60 + row * cellH + cellH / 2,
    })
  })

  // ── Phase 3: initialize positions near cluster anchor ─────────────────
  const sim: SimNode[] = nodes.map(n => {
    const cId = componentOf.get(n.id) ?? n.id
    const anchor = anchors.get(cId)!
    const angle = rand() * Math.PI * 2
    const r = 30 + rand() * 50
    return {
      id: n.id,
      label: n.label,
      type: n.type,
      cluster: cId,
      x: anchor.x + Math.cos(angle) * r,
      y: anchor.y + Math.sin(angle) * r,
      vx: 0,
      vy: 0,
    }
  })

  const idIndex = new Map(sim.map((n, i) => [n.id, i]))
  const validEdges = edges.filter(e => idIndex.has(e.from) && idIndex.has(e.to))

  // ── Tuned constants for large graphs ──────────────────────────────────
  const MIN_SEP         = 260
  const repulsion       = 55000   // strong global spread
  const crossRepulsion  = 80000   // extra push between different clusters
  const springStr       = 0.08    // very weak spring — just enough to group
  const edgeLen         = 180
  const anchorStr       = 0.04    // pull each node toward its cluster anchor
  const centerStr       = 0.0004  // very mild global center pull
  const damping         = 0.75
  const collPush        = 5.0     // constant collision resolution

  for (let iter = 0; iter < iterations; iter++) {
    const cooling = 1 - (iter / iterations) * 0.5

    // Repulsion (cross-cluster gets extra push)
    for (let i = 0; i < sim.length; i++) {
      for (let j = i + 1; j < sim.length; j++) {
        const a = sim[i], b = sim[j]
        let dx = b.x - a.x
        let dy = b.y - a.y
        let distSq = dx * dx + dy * dy
        if (distSq < 1) { dx = rand()-0.5; dy = rand()-0.5; distSq = 0.5 }
        const dist = Math.sqrt(distSq)
        if (dist >= MIN_SEP) continue

        const sameCl = a.cluster === b.cluster
        const str = sameCl ? repulsion * 0.4 : crossRepulsion
        const force = (str / (distSq + 50)) * cooling
        const fx = (dx / dist) * force
        const fy = (dy / dist) * force
        a.vx -= fx; a.vy -= fy
        b.vx += fx; b.vy += fy
      }
    }

    // Rectangle collision (constant strength — no cooling)
    for (let i = 0; i < sim.length; i++) {
      for (let j = i + 1; j < sim.length; j++) {
        const a = sim[i], b = sim[j]
        const dx = b.x - a.x, dy = b.y - a.y
        const hw = NODE_WIDTH / 2 + COLLISION_PADDING / 2
        const hh = NODE_HEIGHT / 2 + COLLISION_PADDING / 2
        const ox = hw - Math.abs(dx)
        const oy = hh - Math.abs(dy)
        if (ox > 0 && oy > 0) {
          if (ox < oy) {
            const push = ox * collPush * (Math.sign(dx) || 1)
            a.vx -= push; b.vx += push
          } else {
            const push = oy * collPush * (Math.sign(dy) || 1)
            a.vy -= push; b.vy += push
          }
        }
      }
    }

    // Spring along edges
    for (const edge of validEdges) {
      const a = sim[idIndex.get(edge.from)!]
      const b = sim[idIndex.get(edge.to)!]
      const dx = b.x - a.x, dy = b.y - a.y
      const dist = Math.sqrt(dx*dx + dy*dy) || 1
      const disp = dist - edgeLen
      const force = disp * springStr * cooling
      const fx = (dx / dist) * force
      const fy = (dy / dist) * force
      a.vx += fx; a.vy += fy
      b.vx -= fx; b.vy -= fy
    }

    // Anchor pull + center pull + integrate
    for (const n of sim) {
      const anchor = anchors.get(n.cluster ?? n.id)!
      n.vx += (anchor.x - n.x) * anchorStr
      n.vy += (anchor.y - n.y) * anchorStr
      n.vx += (cx - n.x) * centerStr
      n.vy += (cy - n.y) * centerStr
      n.vx *= damping
      n.vy *= damping
      n.x += n.vx
      n.y += n.vy

      const pad = NODE_WIDTH / 2 + 40
      n.x = Math.max(pad, Math.min(width  - pad, n.x))
      n.y = Math.max(pad, Math.min(height - pad, n.y))
    }
  }

  return sim.map(n => ({
    id: n.id, label: n.label, type: n.type,
    cluster: n.cluster, x: n.x, y: n.y,
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
