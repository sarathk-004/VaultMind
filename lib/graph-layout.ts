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

const NODE_WIDTH = 132
const NODE_HEIGHT = 36

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
 * Force-directed layout with:
 * - Type-based clustering (nodes of same type start nearby)
 * - Strong repulsion + collision detection (no overlaps)
 * - Spring attraction along edges
 * - Centering force
 */
export function simulateLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
  width: number,
  height: number,
  iterations = 300,
): PositionedNode[] {
  if (nodes.length === 0) return []

  const seedKey = nodes.map(n => n.id).join("|")
  const rand = seededRandom(seedKey)

  const cx = width / 2
  const cy = height / 2

  // 1. Type-clustered initial layout
  const typeGroups: Record<string, SimNode[]> = {}
  for (const n of nodes) {
    const t = n.type || "page"
    if (!typeGroups[t]) typeGroups[t] = []
    typeGroups[t].push({
      id: n.id,
      label: n.label,
      type: n.type,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
    })
  }

  const typeKeys = Object.keys(typeGroups)
  const typeCount = typeKeys.length
  const sim: SimNode[] = []

  for (let i = 0; i < typeKeys.length; i++) {
    const group = typeGroups[typeKeys[i]]
    const angle = (i / typeCount) * Math.PI * 2
    const clusterRadius = Math.min(width, height) * 0.15
    const clusterX = cx + Math.cos(angle) * clusterRadius
    const clusterY = cy + Math.sin(angle) * clusterRadius

    for (let j = 0; j < group.length; j++) {
      const subAngle = (j / group.length) * Math.PI * 2
      group[j].x = clusterX + Math.cos(subAngle) * 50 + (rand() - 0.5) * 30
      group[j].y = clusterY + Math.sin(subAngle) * 50 + (rand() - 0.5) * 30
      sim.push(group[j])
    }
  }

  const idIndex = new Map(sim.map((n, i) => [n.id, i]))
  const validEdges = edges.filter(e => idIndex.has(e.from) && idIndex.has(e.to))

  const idealEdgeLength = Math.min(width, height) * 0.28
  const repulsionStrength = 15000
  const springStrength = 0.05
  const centerStrength = 0.01
  const damping = 0.85
  const collisionPadding = 24 // min space between node edges

  // 2. Run simulation
  for (let iter = 0; iter < iterations; iter++) {
    // Global repulsion
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

    // Collision detection (rectangle overlap → strong push)
    for (let i = 0; i < sim.length; i++) {
      for (let j = i + 1; j < sim.length; j++) {
        const a = sim[i]
        const b = sim[j]
        const dx = b.x - a.x
        const dy = b.y - a.y
        const overlapX = NODE_WIDTH / 2 + collisionPadding - Math.abs(dx)
        const overlapY = NODE_HEIGHT / 2 + collisionPadding - Math.abs(dy)

        if (overlapX > 0 && overlapY > 0) {
          // Overlapping rectangles → push apart along shortest axis
          const pushStrength = 2.5
          if (overlapX < overlapY) {
            const push = (overlapX / 2) * pushStrength
            a.vx -= Math.sign(dx) * push
            b.vx += Math.sign(dx) * push
          } else {
            const push = (overlapY / 2) * pushStrength
            a.vy -= Math.sign(dy) * push
            b.vy += Math.sign(dy) * push
          }
        }
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

      // Keep nodes inside canvas with generous padding
      const padX = NODE_WIDTH / 2 + 40
      const padY = NODE_HEIGHT / 2 + 40
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
