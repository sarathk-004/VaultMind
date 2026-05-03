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
// Add this helper function above simulateLayout
function getConnectedComponents(nodes: GraphNode[], validEdges: GraphEdge[]): Map<string, string> {
  const adj = new Map<string, string[]>()
  nodes.forEach(n => adj.set(n.id, []))
  validEdges.forEach(e => {
    if (adj.has(e.from) && adj.has(e.to)) {
      adj.get(e.from)!.push(e.to)
      adj.get(e.to)!.push(e.from)
    }
  })

  const visited = new Set<string>()
  const nodeToComponent = new Map<string, string>()
  let compId = 0

  for (const node of nodes) {
    if (!visited.has(node.id)) {
      const cName = `island_${compId++}`
      const queue = [node.id]
      visited.add(node.id)
      
      while (queue.length > 0) {
        const curr = queue.shift()!
        nodeToComponent.set(curr, cName)
        for (const neighbor of adj.get(curr)!) {
          if (!visited.has(neighbor)) {
            visited.add(neighbor)
            queue.push(neighbor)
          }
        }
      }
    }
  }
  return nodeToComponent
}

export function simulateLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
  width: number,
  height: number,
  iterations = 600,
): PositionedNode[] {
  if (nodes.length === 0) return []

  const seedKey = nodes.map(n => n.id).join("|")
  const rand = seededRandom(seedKey)

  const cx = width / 2
  const cy = height / 2

  // 1. Filter edges to valid ones first
  const validNodeIds = new Set(nodes.map(n => n.id))
  const validEdges = edges.filter(e => validNodeIds.has(e.from) && validNodeIds.has(e.to))

  // 2. Mathematically group nodes into connected islands
  const nodeToComponent = getConnectedComponents(nodes, validEdges)
  
  const clusterSize = new Map<string, number>()
  nodes.forEach(n => {
    const c = nodeToComponent.get(n.id)!
    clusterSize.set(c, (clusterSize.get(c) ?? 0) + 1)
  })

  // Separate islands (multi-node) from floaters (single-node)
  const multiComps = Array.from(clusterSize.keys())
    .filter(c => (clusterSize.get(c) ?? 0) > 1)
    .sort((a, b) => (clusterSize.get(b) ?? 0) - (clusterSize.get(a) ?? 0))
  
  const singleComps = Array.from(clusterSize.keys())
    .filter(c => (clusterSize.get(c) ?? 0) === 1)

  // 3. Assign physical spaces (Rooms)
  const anchors = new Map<string, { x: number; y: number }>()

  // Put multi-node islands into a clean Grid
  const cols = Math.ceil(Math.sqrt(multiComps.length)) || 1
  const rows = Math.ceil(multiComps.length / cols) || 1
  // Shrink the available grid area slightly so they don't touch the walls
  const gridW = width * 0.8 
  const gridH = height * 0.8
  const offsetX = (width - gridW) / 2
  const offsetY = (height - gridH) / 2
  const cellW = gridW / cols
  const cellH = gridH / rows

  multiComps.forEach((comp, i) => {
    const c = i % cols
    const r = Math.floor(i / cols)
    anchors.set(comp, {
      x: offsetX + (c + 0.5) * cellW,
      y: offsetY + (r + 0.5) * cellH,
    })
  })

  // Put single disconnected nodes in a neat ring around the absolute edge
  const ringRadius = Math.max(width, height) * 0.48
  singleComps.forEach((comp, i) => {
    const angle = (i / Math.max(singleComps.length, 1)) * Math.PI * 2
    anchors.set(comp, {
      x: cx + Math.cos(angle) * ringRadius,
      y: cy + Math.sin(angle) * ringRadius,
    })
  })

  // Initialize nodes near their designated room
  const sim: SimNode[] = nodes.map(n => {
    const cluster = nodeToComponent.get(n.id)!
    const a = anchors.get(cluster)!
    const isSingleton = (clusterSize.get(cluster) ?? 1) === 1
    const localR = isSingleton ? 10 : 80 + rand() * 100
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

  // Physics tuning: Strong cluster pull, almost zero global center pull
  const repulsionStrength = 20000 
  const springStrength = 0.20 
  const clusterStrength = 0.05    // STRONG pull to their specific grid room
  const centerStrength = 0.0001   // STOP pulling everything to the middle
  const damping = 0.75 

  for (let iter = 0; iter < iterations; iter++) {
    const progress = iter / iterations
    const cooling = Math.max(0, 1 - progress)

    // 1. Repulsion
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
          // Push harder if they are from different islands to keep spaces clean
          const crossClusterMultiplier = a.cluster !== b.cluster ? 2.5 : 1.0
          const force = ((repulsionStrength * crossClusterMultiplier) / (distSq + 100)) * cooling
          const fx = (dx / dist) * force
          const fy = (dy / dist) * force
          a.vx -= fx
          a.vy -= fy
          b.vx += fx
          b.vy += fy
        }
      }
    }

    // 2. Collision Resolution
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

    // 3. Springs
    const edgeLength = 100
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

    // 4. Gravity & Integration
    for (const n of sim) {
      const anchor = anchors.get(n.cluster)!
      // Pull strongly to their assigned room
      n.vx += (anchor.x - n.x) * clusterStrength * cooling 
      n.vy += (anchor.y - n.y) * clusterStrength * cooling
      
      // Weak global center pull
      n.vx += (cx - n.x) * centerStrength * cooling
      n.vy += (cy - n.y) * centerStrength * cooling
      
      n.vx *= damping
      n.vy *= damping
      n.x += n.vx
      n.y += n.vy

      // Keep them loosely in bounds
      const boundPadding = NODE_WIDTH / 2
      n.x = Math.max(boundPadding, Math.min(width - boundPadding, n.x))
      n.y = Math.max(boundPadding, Math.min(height - boundPadding, n.y))
    }
  }

  return sim.map(n => ({
    id: n.id,
    label: n.label,
    type: n.type,
    cluster: n.cluster, // keep original cluster property on return
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
