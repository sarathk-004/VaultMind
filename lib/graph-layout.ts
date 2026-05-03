import type { GraphNode, GraphEdge } from "./vaultmind-types"

export interface PositionedNode extends GraphNode {
  x: number
  y: number
}

interface SimNode {
  id: string
  label: string
  type?: string
  x: number
  y: number
  vx: number
  vy: number
}

/**
 * Deterministic pseudo-random based on string hash, so layout is stable per query.
 */
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
 * Simple force-directed simulation with:
 * - Repulsion between all nodes
 * - Spring attraction along edges
 * - Mild centering force
 *
 * Returns final settled positions (run synchronously, fixed iterations).
 */
export function simulateLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
  width: number,
  height: number,
  iterations = 220,
): PositionedNode[] {
  if (nodes.length === 0) return []

  const seedKey = nodes.map(n => n.id).join("|")
  const rand = seededRandom(seedKey)

  const cx = width / 2
  const cy = height / 2
  const ringRadius = Math.min(width, height) * 0.32

  // 1. Initial circular layout with slight random offset
  const sim: SimNode[] = nodes.map((n, i) => {
    const angle = (i / nodes.length) * Math.PI * 2
    return {
      id: n.id,
      label: n.label,
      type: n.type,
      x: cx + Math.cos(angle) * ringRadius + (rand() - 0.5) * 30,
      y: cy + Math.sin(angle) * ringRadius + (rand() - 0.5) * 30,
      vx: 0,
      vy: 0,
    }
  })

  const idIndex = new Map(sim.map((n, i) => [n.id, i]))
  const validEdges = edges.filter(e => idIndex.has(e.from) && idIndex.has(e.to))

  const idealEdgeLength = Math.min(width, height) * 0.22
  const repulsionStrength = 9000
  const springStrength = 0.04
  const centerStrength = 0.012
  const damping = 0.82

  // 2. Run simulation
  for (let iter = 0; iter < iterations; iter++) {
    // Repulsion: every pair pushes each other apart
    for (let i = 0; i < sim.length; i++) {
      for (let j = i + 1; j < sim.length; j++) {
        const a = sim[i]
        const b = sim[j]
        let dx = b.x - a.x
        let dy = b.y - a.y
        let distSq = dx * dx + dy * dy
        if (distSq < 1) {
          dx = rand() - 0.5
          dy = rand() - 0.5
          distSq = 1
        }
        const dist = Math.sqrt(distSq)
        const force = repulsionStrength / distSq
        const fx = (dx / dist) * force
        const fy = (dy / dist) * force
        a.vx -= fx
        a.vy -= fy
        b.vx += fx
        b.vy += fy
      }
    }

    // Spring attraction along edges
    for (const edge of validEdges) {
      const a = sim[idIndex.get(edge.from)!]
      const b = sim[idIndex.get(edge.to)!]
      const dx = b.x - a.x
      const dy = b.y - a.y
      const dist = Math.sqrt(dx * dx + dy * dy) || 1
      const displacement = dist - idealEdgeLength
      const force = displacement * springStrength
      const fx = (dx / dist) * force
      const fy = (dy / dist) * force
      a.vx += fx
      a.vy += fy
      b.vx -= fx
      b.vy -= fy
    }

    // Centering + integrate
    for (const n of sim) {
      n.vx += (cx - n.x) * centerStrength
      n.vy += (cy - n.y) * centerStrength
      n.vx *= damping
      n.vy *= damping
      n.x += n.vx
      n.y += n.vy

      // Keep nodes inside the canvas with padding
      const padX = 80
      const padY = 28
      n.x = Math.max(padX, Math.min(width - padX, n.x))
      n.y = Math.max(padY, Math.min(height - padY, n.y))
    }
  }

  return sim.map(n => ({
    id: n.id,
    label: n.label,
    type: n.type,
    x: n.x,
    y: n.y,
  }))
}

/**
 * Build an adjacency map for fast neighbor lookup (for hover highlighting).
 */
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
