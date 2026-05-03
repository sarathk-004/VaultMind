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
  pinned?: boolean
}

const NODE_WIDTH = 140
const NODE_HEIGHT = 40
const MIN_SEPARATION = 180 // Minimum distance between node centers
const COLLISION_PADDING = 30

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
 * Multi-pass force-directed layout with aggressive collision detection.
 * - Initial: spread nodes in a grid + random offset
 * - Pass 1: Strong repulsion to push apart
 * - Pass 2: Collision resolution (rectangle overlaps)
 * - Pass 3: Spring attraction along edges
 * - Iterations: 500+ with gradual cooling
 */
export function simulateLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
  width: number,
  height: number,
  iterations = 500,
): PositionedNode[] {
  if (nodes.length === 0) return []

  const seedKey = nodes.map(n => n.id).join("|")
  const rand = seededRandom(seedKey)

  const cx = width / 2
  const cy = height / 2
  const padding = 80

  // 1. Initialize in a grid-like pattern with random jitter
  const sim: SimNode[] = []
  const cols = Math.ceil(Math.sqrt(nodes.length))
  const cellW = (width - 2 * padding) / cols
  const cellH = (height - 2 * padding) / cols

  for (let i = 0; i < nodes.length; i++) {
    const row = Math.floor(i / cols)
    const col = i % cols
    const baseX = padding + col * cellW + cellW / 2
    const baseY = padding + row * cellH + cellH / 2
    const jitterX = (rand() - 0.5) * (cellW * 0.6)
    const jitterY = (rand() - 0.5) * (cellH * 0.6)
    
    sim.push({
      id: nodes[i].id,
      label: nodes[i].label,
      type: nodes[i].type,
      x: baseX + jitterX,
      y: baseY + jitterY,
      vx: 0,
      vy: 0,
    })
  }

  const idIndex = new Map(sim.map((n, i) => [n.id, i]))
  const validEdges = edges.filter(e => idIndex.has(e.from) && idIndex.has(e.to))

  const repulsionStrength = 25000
  const springStrength = 0.08
  const centerStrength = 0.004
  const damping = 0.82

  // 2. Run simulation with cooling
  for (let iter = 0; iter < iterations; iter++) {
    const progress = iter / iterations
    const cooling = 1 - progress * 0.6

    // Global repulsion (pair-wise)
    for (let i = 0; i < sim.length; i++) {
      for (let j = i + 1; j < sim.length; j++) {
        const a = sim[i]
        const b = sim[j]
        let dx = b.x - a.x
        let dy = b.y - a.y
        let distSq = dx * dx + dy * dy
        
        if (distSq < 100) {
          dx = (rand() - 0.5) * 2
          dy = (rand() - 0.5) * 2
          distSq = 1
        }

        const dist = Math.sqrt(distSq)
        const minDist = MIN_SEPARATION
        
        // Use a min distance: repel if closer than minDist
        if (dist < minDist) {
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

    // Collision detection with rectangle overlap resolution
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
          const pushStrength = 3.5 * cooling
          if (overlapX < overlapY) {
            // Push along X axis
            const push = overlapX * pushStrength
            const dir = Math.sign(dx) || 1
            a.vx -= push * dir
            b.vx += push * dir
          } else {
            // Push along Y axis
            const push = overlapY * pushStrength
            const dir = Math.sign(dy) || 1
            a.vy -= push * dir
            b.vy += push * dir
          }
        }
      }
    }

    // Spring attraction along edges (with cooling)
    const edgeLength = Math.min(width, height) * 0.25
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

    // Center attraction + integrate velocity + apply damping
    for (const n of sim) {
      n.vx += (cx - n.x) * centerStrength
      n.vy += (cy - n.y) * centerStrength
      n.vx *= damping
      n.vy *= damping
      n.x += n.vx
      n.y += n.vy

      // Enforce bounds with generous padding
      const boundPadding = NODE_WIDTH / 2 + 50
      n.x = Math.max(boundPadding, Math.min(width - boundPadding, n.x))
      n.y = Math.max(boundPadding, Math.min(height - boundPadding, n.y))
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
