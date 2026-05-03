"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Maximize2, Network } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { KnowledgeGraph } from "@/lib/vaultmind-types"
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
  onNodeClick: (nodeId: string) => void
}

const NODE_WIDTH = 132
const NODE_HEIGHT = 36

export function KnowledgeGraphPanel({ graph, highlightedNodeId, onNodeClick }: KnowledgeGraphPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 420, height: 600 })
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  // Track container size for responsive layout
  useEffect(() => {
    if (!containerRef.current) return
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        if (width > 0 && height > 0) {
          setSize({ width, height })
        }
      }
    })
    ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [])

  const positionedNodes: PositionedNode[] = useMemo(() => {
    if (!graph || graph.nodes.length === 0) return []
    return simulateLayout(graph.nodes, graph.edges, size.width, size.height)
  }, [graph, size.width, size.height])

  const positionMap = useMemo(() => {
    const m = new Map<string, PositionedNode>()
    positionedNodes.forEach(n => m.set(n.id, n))
    return m
  }, [positionedNodes])

  const adjacency = useMemo(() => (graph ? buildAdjacency(graph.edges) : new Map()), [graph])

  // The "active" node is whatever is hovered, or whatever is highlighted from chat
  const activeId = hoveredId || highlightedNodeId
  const activeNeighbors: Set<string> = useMemo(() => {
    if (!activeId) return new Set()
    const n = adjacency.get(activeId)
    return n ? new Set(n) : new Set()
  }, [activeId, adjacency])

  const isEdgeActive = (from: string, to: string) =>
    activeId !== null && (from === activeId || to === activeId)

  const isNodeDimmed = (id: string) => {
    if (!activeId) return false
    if (id === activeId) return false
    return !activeNeighbors.has(id)
  }

  const hasGraph = graph && graph.nodes.length > 0

  return (
    <aside className="flex flex-col h-full w-[420px] shrink-0 border-l border-border bg-sidebar">
      {/* Header */}
      <header className="flex items-center justify-between px-4 h-14 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <Network className="h-4 w-4 text-muted-foreground" aria-hidden />
          <h2 className="text-sm font-medium tracking-tight">Knowledge Graph</h2>
          {hasGraph && (
            <span className="text-xs text-muted-foreground ml-2">
              {graph.nodes.length} nodes · {graph.edges.length} edges
            </span>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          aria-label="Expand graph"
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </Button>
      </header>

      {/* Canvas */}
      <div ref={containerRef} className="relative flex-1 graph-grid overflow-hidden">
        {!hasGraph ? (
          <EmptyState />
        ) : (
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
              {graph!.edges.map((edge, idx) => {
                const a = positionMap.get(edge.from)
                const b = positionMap.get(edge.to)
                if (!a || !b) return null
                const active = isEdgeActive(edge.from, edge.to)
                const dimmed = activeId && !active

                // Curved bezier path
                const dx = b.x - a.x
                const dy = b.y - a.y
                const mx = (a.x + b.x) / 2
                const my = (a.y + b.y) / 2
                // Perpendicular offset for curve
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
                    stroke={active ? "#60a5fa" : "#525252"}
                    strokeWidth={active ? 1.5 : 1}
                    strokeOpacity={dimmed ? 0.15 : active ? 0.9 : 0.5}
                    style={{ transition: "stroke 0.25s, stroke-opacity 0.25s, stroke-width 0.25s" }}
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
                const isNeighbor = activeNeighbors.has(node.id)
                const dimmed = isNodeDimmed(node.id)

                return (
                  <g
                    key={node.id}
                    transform={`translate(${node.x - NODE_WIDTH / 2}, ${node.y - NODE_HEIGHT / 2})`}
                    style={{
                      transition: "transform 0.5s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.25s",
                      opacity: dimmed ? 0.35 : 1,
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
                        strokeOpacity={0.5}
                        strokeDasharray="3 3"
                      />
                    )}
                    <rect
                      width={NODE_WIDTH}
                      height={NODE_HEIGHT}
                      rx={6}
                      fill={colors.fill}
                      stroke={colors.stroke}
                      strokeWidth={isActive || isHighlighted ? 1.6 : 1}
                      style={{ transition: "stroke-width 0.2s" }}
                    />
                    {/* Type indicator dot */}
                    <circle cx={10} cy={NODE_HEIGHT / 2} r={3} fill={colors.stroke} />
                    {/* Label */}
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
        )}
      </div>

      {/* Legend */}
      {hasGraph && (
        <footer className="flex items-center gap-3 px-4 h-10 border-t border-border text-xs text-muted-foreground shrink-0">
          <LegendDot color="#3b82f6" label="Page" />
          <LegendDot color="#a855f7" label="Database" />
          <LegendDot color="#22c55e" label="Task" />
          <LegendDot color="#f59e0b" label="Note" />
        </footer>
      )}
    </aside>
  )
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span
        className="inline-block h-2 w-2 rounded-full"
        style={{ backgroundColor: color }}
        aria-hidden
      />
      <span>{label}</span>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-8">
      <div className="h-10 w-10 rounded-md border border-border bg-card flex items-center justify-center mb-4">
        <Network className="h-5 w-5 text-muted-foreground" aria-hidden />
      </div>
      <p className="text-sm text-foreground font-medium">Your knowledge graph will appear here</p>
      <p className="text-xs text-muted-foreground mt-1.5 max-w-[260px] text-balance">
        Send a message to query your workspace and visualize the connections between pages, databases, and notes.
      </p>
    </div>
  )
}
