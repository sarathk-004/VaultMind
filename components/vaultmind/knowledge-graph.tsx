"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Maximize2, Network } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { GraphNode, KnowledgeGraph } from "@/lib/vaultmind-types"
import { getFullWorkspaceGraph } from "@/lib/workspace-data"
import {
  buildAdjacency,
  getNodeColor,
  simulateLayout,
  truncateLabel,
  type PositionedNode,
} from "@/lib/graph-layout"

interface KnowledgeGraphPanelProps {
  graph: KnowledgeGraph | null
  highlightedNodeId: string | null
  focusedNodeIds: Set<string>
  onNodeClick: (nodeId: string) => void
  onClose?: () => void
  className?: string
}

const NODE_WIDTH = 132
const NODE_HEIGHT = 36

export function KnowledgeGraphPanel({
  graph,
  highlightedNodeId,
  focusedNodeIds,
  onNodeClick,
  className,
}: KnowledgeGraphPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 420, height: 600 })
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  // Always render the FULL workspace as the "vault map".
  // The query-returned `graph` defines the focused subset.
  const fullGraph = useMemo(() => getFullWorkspaceGraph(), [])

  // Track container size for responsive layout
  useEffect(() => {
    const node = containerRef.current
    if (!node) return
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        if (width > 0 && height > 0) {
          setSize({ width, height })
        }
      }
    })
    ro.observe(node)
    // Also seed with current size immediately
    const rect = node.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0) {
      setSize({ width: rect.width, height: rect.height })
    }
    return () => ro.disconnect()
  }, [])

  // Layout the full graph. Re-runs only when size or graph topology changes.
  const positionedNodes: PositionedNode[] = useMemo(() => {
    return simulateLayout(fullGraph.nodes, fullGraph.edges, size.width, size.height)
  }, [fullGraph, size.width, size.height])

  const positionMap = useMemo(() => {
    const m = new Map<string, PositionedNode>()
    positionedNodes.forEach(n => m.set(n.id, n))
    return m
  }, [positionedNodes])

  const adjacency = useMemo(() => buildAdjacency(fullGraph.edges), [fullGraph.edges])

  const queryActive = focusedNodeIds.size > 0
  // Active node — hover wins over chat-driven highlight
  const activeId = hoveredId || highlightedNodeId
  const activeNeighbors: Set<string> = useMemo(() => {
    if (!activeId) return new Set()
    const n = adjacency.get(activeId)
    return n ? new Set(n) : new Set()
  }, [activeId, adjacency])

  const isFocused = (id: string) => !queryActive || focusedNodeIds.has(id)
  const isEdgeActive = (from: string, to: string) =>
    activeId !== null && (from === activeId || to === activeId)
  const isEdgeFocused = (from: string, to: string) =>
    !queryActive || (focusedNodeIds.has(from) && focusedNodeIds.has(to))

  const nodeOpacity = (id: string) => {
    // When user is hovering a node, fade everything that's not the node or a neighbor
    if (activeId) {
      if (id === activeId) return 1
      if (activeNeighbors.has(id)) return 0.95
      return queryActive && isFocused(id) ? 0.5 : 0.18
    }
    if (queryActive) return isFocused(id) ? 1 : 0.22
    return 0.92
  }

  const edgeOpacity = (from: string, to: string) => {
    const active = isEdgeActive(from, to)
    if (active) return 0.9
    if (activeId) return 0.08
    if (queryActive) return isEdgeFocused(from, to) ? 0.7 : 0.08
    return 0.4
  }

  const nodeCount = fullGraph.nodes.length
  const focusedCount = focusedNodeIds.size

  return (
    <aside
      className={
        "flex flex-col h-full w-full lg:w-[420px] lg:shrink-0 lg:border-l border-border bg-sidebar " +
        (className ?? "")
      }
    >
      {/* Header */}
      <header className="flex items-center justify-between px-4 h-14 border-b border-border shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Network className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden />
          <h2 className="text-sm font-medium tracking-tight">Knowledge Graph</h2>
          <span className="text-xs text-muted-foreground ml-2 truncate">
            {queryActive
              ? `${focusedCount} focused · ${nodeCount} total`
              : `${nodeCount} nodes · ${fullGraph.edges.length} edges`}
          </span>
        </div>
        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Expand graph">
          <Maximize2 className="h-3.5 w-3.5" />
        </Button>
      </header>

      {/* Canvas */}
      <div ref={containerRef} className="relative flex-1 graph-grid overflow-hidden">
        {!queryActive && graph === null && (
          <div className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 z-10">
            <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/80 bg-background/70 backdrop-blur-sm px-2.5 py-1 rounded border border-border/60">
              Full vault — ask a question to focus
            </div>
          </div>
        )}

        <svg
          width="100%"
          height="100%"
          viewBox={`0 0 ${size.width} ${size.height}`}
          className="absolute inset-0"
          role="img"
          aria-label="Knowledge graph visualization"
        >
          {/* Edges */}
          <g>
            {fullGraph.edges.map((edge, idx) => {
              const a = positionMap.get(edge.from)
              const b = positionMap.get(edge.to)
              if (!a || !b) return null
              const active = isEdgeActive(edge.from, edge.to)
              const focused = isEdgeFocused(edge.from, edge.to)

              const dx = b.x - a.x
              const dy = b.y - a.y
              const mx = (a.x + b.x) / 2
              const my = (a.y + b.y) / 2
              const norm = Math.sqrt(dx * dx + dy * dy) || 1
              const offset = Math.min(40, norm * 0.15)
              const cx = mx + (-dy / norm) * offset
              const cy = my + (dx / norm) * offset
              const path = `M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}`

              return (
                <path
                  key={`edge-${idx}`}
                  d={path}
                  fill="none"
                  stroke={active ? "#60a5fa" : focused && queryActive ? "#9ca3af" : "#525252"}
                  strokeWidth={active ? 1.5 : 1}
                  strokeOpacity={edgeOpacity(edge.from, edge.to)}
                  style={{
                    transition:
                      "stroke 0.25s, stroke-opacity 0.25s, stroke-width 0.25s",
                  }}
                />
              )
            })}
          </g>

          {/* Nodes */}
          <g>
            {positionedNodes.map(node => {
              const colors = getNodeColor(node.type)
              const isActive = node.id === activeId
              const isHighlighted = node.id === highlightedNodeId
              const focused = isFocused(node.id)

              return (
                <g
                  key={node.id}
                  transform={`translate(${node.x - NODE_WIDTH / 2}, ${node.y - NODE_HEIGHT / 2})`}
                  style={{
                    transition:
                      "transform 0.5s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.3s",
                    opacity: nodeOpacity(node.id),
                    cursor: "pointer",
                  }}
                  onMouseEnter={() => setHoveredId(node.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  onClick={() => onNodeClick(node.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault()
                      onNodeClick(node.id)
                    }
                  }}
                  aria-label={`${node.label}, ${node.type || "page"}`}
                >
                  {/* Highlight ring (when clicked from chat) */}
                  {isHighlighted && (
                    <rect
                      x={-4}
                      y={-4}
                      width={NODE_WIDTH + 8}
                      height={NODE_HEIGHT + 8}
                      rx={10}
                      fill="none"
                      stroke={colors.stroke}
                      strokeWidth={1.5}
                      strokeOpacity={0.6}
                      strokeDasharray="3 3"
                    />
                  )}
                  <rect
                    width={NODE_WIDTH}
                    height={NODE_HEIGHT}
                    rx={6}
                    fill={colors.fill}
                    stroke={colors.stroke}
                    strokeWidth={isActive || isHighlighted || (queryActive && focused) ? 1.6 : 1}
                    style={{ transition: "stroke-width 0.2s" }}
                  />
                  <circle cx={10} cy={NODE_HEIGHT / 2} r={3} fill={colors.stroke} />
                  <text
                    x={20}
                    y={NODE_HEIGHT / 2}
                    dominantBaseline="middle"
                    fontSize={11}
                    fontFamily="var(--font-sans)"
                    fontWeight={500}
                    fill={colors.text}
                  >
                    {truncateLabel(node.label, 16)}
                  </text>
                </g>
              )
            })}
          </g>
        </svg>
      </div>

      {/* Legend */}
      <footer className="flex items-center gap-3 px-4 h-10 border-t border-border text-xs text-muted-foreground shrink-0 overflow-x-auto">
        <LegendDot color="#3b82f6" label="Page" />
        <LegendDot color="#a855f7" label="Database" />
        <LegendDot color="#22c55e" label="Task" />
        <LegendDot color="#f59e0b" label="Note" />
      </footer>
    </aside>
  )
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <span
        className="inline-block h-2 w-2 rounded-full"
        style={{ backgroundColor: color }}
        aria-hidden
      />
      <span>{label}</span>
    </div>
  )
}

// Re-export type used elsewhere
export type { GraphNode }
