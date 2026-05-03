"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Maximize2, Minimize2, Network, Loader2, ZoomIn, ZoomOut, Locate } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import type { KnowledgeGraph } from "@/lib/vaultmind-types"
import {
  buildAdjacency,
  getNodeColor,
  simulateLayout,
  truncateLabel,
  type PositionedNode,
} from "@/lib/graph-layout"

interface KnowledgeGraphPanelProps {
  workspaceGraph: KnowledgeGraph | null
  focusedGraph: KnowledgeGraph | null
  highlightedNodeId: string | null
  showFullGraph: boolean
  onNodeClick: (nodeId: string) => void
  workspaceLoading?: boolean
  className?: string
}

const NODE_WIDTH = 132
const NODE_HEIGHT = 36
const MIN_ZOOM = 0.3
const MAX_ZOOM = 3

export function KnowledgeGraphPanel(props: KnowledgeGraphPanelProps) {
  const [fullscreen, setFullscreen] = useState(false)

  return (
    <>
      <aside
        className={
          "flex flex-col h-full w-full lg:w-[420px] lg:shrink-0 lg:border-l border-border bg-sidebar " +
          (props.className ?? "")
        }
      >
        <GraphCanvas {...props} fullscreen={false} onToggleFullscreen={() => setFullscreen(true)} />
      </aside>

      <Dialog open={fullscreen} onOpenChange={setFullscreen}>
        <DialogContent
          showCloseButton={false}
          className="!fixed !inset-0 !top-0 !left-0 !translate-x-0 !translate-y-0 !w-screen !h-[100dvh] !max-w-none !p-0 !gap-0 !rounded-none !border-0 flex flex-col bg-sidebar"
        >
          <DialogTitle className="sr-only">Knowledge Graph</DialogTitle>
          <GraphCanvas
            {...props}
            fullscreen
            onToggleFullscreen={() => setFullscreen(false)}
          />
        </DialogContent>
      </Dialog>
    </>
  )
}

interface GraphCanvasProps extends KnowledgeGraphPanelProps {
  fullscreen: boolean
  onToggleFullscreen: () => void
}

function GraphCanvas({
  workspaceGraph,
  focusedGraph,
  highlightedNodeId,
  showFullGraph,
  onNodeClick,
  workspaceLoading,
  fullscreen,
  onToggleFullscreen,
}: GraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [size, setSize] = useState({ width: 420, height: 600 })
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  // Zoom + pan state
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 })
  // Per-node drag overrides (id → {x, y})
  const [dragOverrides, setDragOverrides] = useState<Map<string, { x: number; y: number }>>(
    new Map(),
  )

  useEffect(() => {
    const node = containerRef.current
    if (!node) return
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        if (width > 0 && height > 0) setSize({ width, height })
      }
    })
    ro.observe(node)
    const rect = node.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0) setSize({ width: rect.width, height: rect.height })
    return () => ro.disconnect()
  }, [])

  // Reset overrides when graph changes
  useEffect(() => {
    setDragOverrides(new Map())
  }, [workspaceGraph, focusedGraph, showFullGraph])

  const focusedNodeIds = useMemo(
    () => new Set((focusedGraph?.nodes ?? []).map(n => n.id)),
    [focusedGraph],
  )
  const queryActive = focusedNodeIds.size > 0

  const renderGraph: KnowledgeGraph | null = useMemo(() => {
    if (showFullGraph) return workspaceGraph
    return focusedGraph ?? null
  }, [showFullGraph, workspaceGraph, focusedGraph])

  // Layout coordinate space is *independent* of the viewport — pan/zoom adapts
  // it to whatever panel size we have. This way the side panel and fullscreen
  // render the exact same physical layout, just at different zoom levels.
  const virtualSize = useMemo(() => {
    const n = renderGraph?.nodes.length ?? 0
    if (n === 0) return { w: 1200, h: 800 }
    // Target ~270px of breathing room per node (matches MIN_SEPARATION in graph-layout).
    const PER_NODE_AREA = 270 * 270
    const totalArea = n * PER_NODE_AREA
    const side = Math.sqrt(totalArea) * 1.45
    const h = Math.max(700, side)
    // Slightly wider than tall reads better for force-directed graphs.
    return { w: h * 1.4, h }
  }, [renderGraph])

  const positionedNodes: PositionedNode[] = useMemo(() => {
    if (!renderGraph) return []
    const sim = simulateLayout(renderGraph.nodes, renderGraph.edges, virtualSize.w, virtualSize.h)
    return sim.map(n => {
      const ov = dragOverrides.get(n.id)
      return ov ? { ...n, x: ov.x, y: ov.y } : n
    })
  }, [renderGraph, virtualSize.w, virtualSize.h, dragOverrides])

  const positionMap = useMemo(() => {
    const m = new Map<string, PositionedNode>()
    positionedNodes.forEach(n => m.set(n.id, n))
    return m
  }, [positionedNodes])

  const adjacency = useMemo(
    () => buildAdjacency(renderGraph?.edges ?? []),
    [renderGraph],
  )

  const activeId = hoveredId || highlightedNodeId
  const activeNeighbors: Set<string> = useMemo(() => {
    if (!activeId) return new Set()
    const n = adjacency.get(activeId)
    return n ? new Set(n) : new Set()
  }, [activeId, adjacency])

  const isFocused = (id: string) => {
    if (!showFullGraph) return true
    if (!queryActive) return true
    return focusedNodeIds.has(id)
  }

  const isEdgeActive = (from: string, to: string) =>
    activeId !== null && (from === activeId || to === activeId)

  const isEdgeFocused = (from: string, to: string) => {
    if (!showFullGraph || !queryActive) return true
    return focusedNodeIds.has(from) && focusedNodeIds.has(to)
  }

  const nodeOpacity = (id: string) => {
    if (activeId) {
      if (id === activeId) return 1
      if (activeNeighbors.has(id)) return 0.95
      return isFocused(id) ? 0.5 : 0.18
    }
    if (showFullGraph && queryActive) return isFocused(id) ? 1 : 0.22
    return 0.92
  }

  const edgeOpacity = (from: string, to: string) => {
    const active = isEdgeActive(from, to)
    if (active) return 0.9
    if (activeId) return 0.08
    if (showFullGraph && queryActive) return isEdgeFocused(from, to) ? 0.7 : 0.08
    return 0.4
  }

  // ── Pan + zoom + drag handlers ──────────────────────────────────────

  const interactionRef = useRef<{
    type: "pan" | "node" | null
    nodeId?: string
    startClientX: number
    startClientY: number
    startNodeX?: number
    startNodeY?: number
    startTx?: number
    startTy?: number
    moved?: boolean
  }>({ type: null, startClientX: 0, startClientY: 0 })

  const screenToWorld = useCallback(
    (clientX: number, clientY: number) => {
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return { x: 0, y: 0 }
      const sx = clientX - rect.left
      const sy = clientY - rect.top
      return { x: (sx - transform.x) / transform.k, y: (sy - transform.y) / transform.k }
    },
    [transform],
  )

  // React's onWheel uses passive listeners, so preventDefault() is ignored —
  // letting trackpad pinch (deltaY with ctrlKey=true) zoom the whole page.
  // Attach a native non-passive listener instead.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const handler = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const sx = e.clientX - rect.left
      const sy = e.clientY - rect.top
      // Pinch zoom on trackpad arrives as a wheel event with ctrlKey=true and
      // larger deltaY values; tame it with a smaller per-event factor.
      const intensity = e.ctrlKey ? 0.02 : 0.1
      const factor = e.deltaY < 0 ? 1 + intensity : 1 / (1 + intensity)
      setTransform(prev => {
        const newK = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, prev.k * factor))
        const ratio = newK / prev.k
        return {
          k: newK,
          x: sx - (sx - prev.x) * ratio,
          y: sy - (sy - prev.y) * ratio,
        }
      })
    }
    el.addEventListener("wheel", handler, { passive: false })
    return () => el.removeEventListener("wheel", handler)
  }, [])

  const onBackgroundMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    interactionRef.current = {
      type: "pan",
      startClientX: e.clientX,
      startClientY: e.clientY,
      startTx: transform.x,
      startTy: transform.y,
      moved: false,
    }
  }

  const onNodeMouseDown = (e: React.MouseEvent, nodeId: string) => {
    e.stopPropagation()
    if (e.button !== 0) return
    const node = positionMap.get(nodeId)
    if (!node) return
    interactionRef.current = {
      type: "node",
      nodeId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startNodeX: node.x,
      startNodeY: node.y,
      moved: false,
    }
  }

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const it = interactionRef.current
      if (!it.type) return
      const dx = e.clientX - it.startClientX
      const dy = e.clientY - it.startClientY
      if (Math.abs(dx) + Math.abs(dy) > 3) it.moved = true

      if (it.type === "pan") {
        setTransform(prev => ({
          ...prev,
          x: (it.startTx ?? 0) + dx,
          y: (it.startTy ?? 0) + dy,
        }))
      } else if (it.type === "node" && it.nodeId && it.startNodeX != null && it.startNodeY != null) {
        const nx = it.startNodeX + dx / transform.k
        const ny = it.startNodeY + dy / transform.k
        setDragOverrides(prev => {
          const next = new Map(prev)
          next.set(it.nodeId!, { x: nx, y: ny })
          return next
        })
      }
    }
    const onUp = () => {
      interactionRef.current = { type: null, startClientX: 0, startClientY: 0 }
    }
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
    return () => {
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
    }
  }, [transform.k])

  // Computes a zoom level that fits, but clamps to a readable minimum so the
  // side panel doesn't end up at 8% zoom when there are 100+ nodes — instead
  // the user pans to navigate. Fullscreen uses the true fit value.
  const computeFitTransform = useCallback(() => {
    const fit = Math.min(size.width / virtualSize.w, size.height / virtualSize.h, 1)
    const minReadable = fullscreen ? fit : Math.max(fit, 0.55)
    const k = minReadable
    return {
      k,
      x: (size.width - virtualSize.w * k) / 2,
      y: (size.height - virtualSize.h * k) / 2,
    }
  }, [size.width, size.height, virtualSize.w, virtualSize.h, fullscreen])

  // Re-center on graph change
  const lastGraphKey = useRef<string>("")
  useEffect(() => {
    const key = (renderGraph?.nodes ?? []).map(n => n.id).join("|")
    if (key === lastGraphKey.current) return
    lastGraphKey.current = key
    if (!renderGraph || renderGraph.nodes.length === 0) return
    setTransform(computeFitTransform())
  }, [renderGraph, computeFitTransform])

  const recenter = () => {
    if (!renderGraph || renderGraph.nodes.length === 0) return
    setTransform(computeFitTransform())
    setDragOverrides(new Map())
  }

  const zoomBy = (factor: number) => {
    setTransform(prev => {
      const newK = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, prev.k * factor))
      const ratio = newK / prev.k
      const cx = size.width / 2
      const cy = size.height / 2
      return {
        k: newK,
        x: cx - (cx - prev.x) * ratio,
        y: cy - (cy - prev.y) * ratio,
      }
    })
  }

  const handleNodeClickGuarded = (id: string) => {
    if (interactionRef.current.moved) return // suppress click after drag
    onNodeClick(id)
  }

  const totalNodes = renderGraph?.nodes.length ?? 0
  const totalEdges = renderGraph?.edges.length ?? 0
  const focusedCount = focusedNodeIds.size

  const isEmpty = !workspaceLoading && (!renderGraph || renderGraph.nodes.length === 0)

  return (
    <>
      <header className="flex items-center justify-between px-4 h-14 border-b border-border shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Network className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden />
          <h2 className="text-sm font-medium tracking-tight">Knowledge Graph</h2>
          <span className="text-xs text-muted-foreground ml-2 truncate">
            {workspaceLoading
              ? "Loading workspace…"
              : showFullGraph && queryActive
              ? `${focusedCount} focused · ${totalNodes} shown`
              : `${totalNodes} nodes · ${totalEdges} edges`}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => zoomBy(1.2)} aria-label="Zoom in">
            <ZoomIn className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => zoomBy(1 / 1.2)} aria-label="Zoom out">
            <ZoomOut className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={recenter} aria-label="Recenter">
            <Locate className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={onToggleFullscreen}
            aria-label={fullscreen ? "Close fullscreen" : "Expand graph"}
          >
            {fullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </header>

      <div
        ref={containerRef}
        className="relative flex-1 graph-grid overflow-hidden select-none"
        style={{ cursor: interactionRef.current.type === "pan" ? "grabbing" : "grab" }}
        onMouseDown={onBackgroundMouseDown}
      >
        {workspaceLoading && (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground pointer-events-none">
            <div className="flex items-center gap-2 text-xs">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              <span>Fetching workspace from Notion…</span>
            </div>
          </div>
        )}

        {isEmpty && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6 pointer-events-none">
            <Network className="h-8 w-8 text-muted-foreground/40 mb-3" aria-hidden />
            <p className="text-sm text-muted-foreground">
              {showFullGraph
                ? "Your knowledge graph will appear here"
                : "Ask a question to see a focused subgraph"}
            </p>
            <p className="text-[11px] text-muted-foreground/70 mt-1.5 max-w-xs">
              {showFullGraph
                ? "Connect a workspace and we'll map your pages, databases, tasks and notes."
                : "Toggle 'Show full workspace graph' in settings to always see the entire vault."}
            </p>
          </div>
        )}

        {!isEmpty && !workspaceLoading && showFullGraph && !queryActive && (
          <div className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 z-10">
            <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/80 bg-background/70 backdrop-blur-sm px-2.5 py-1 rounded border border-border/60">
              Drag · scroll to zoom · ask to focus
            </div>
          </div>
        )}

        <svg
          ref={svgRef}
          width="100%"
          height="100%"
          className="absolute inset-0"
          role="img"
          aria-label="Knowledge graph visualization"
          style={{ touchAction: "none" }}
        >
          <g transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`}>
            <g>
              {(renderGraph?.edges ?? []).map((edge, idx) => {
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
                    stroke={
                      active
                        ? "#60a5fa"
                        : focused && showFullGraph && queryActive
                        ? "#9ca3af"
                        : "#525252"
                    }
                    strokeWidth={(active ? 1.5 : 1) / transform.k}
                    strokeOpacity={edgeOpacity(edge.from, edge.to)}
                    style={{ transition: "stroke 0.25s, stroke-opacity 0.25s" }}
                  />
                )
              })}
            </g>

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
                      transition: dragOverrides.has(node.id)
                        ? "none"
                        : "transform 0.5s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.3s",
                      opacity: nodeOpacity(node.id),
                      cursor: "pointer",
                    }}
                    onMouseEnter={() => setHoveredId(node.id)}
                    onMouseLeave={() => setHoveredId(null)}
                    onMouseDown={e => onNodeMouseDown(e, node.id)}
                    onClick={() => handleNodeClickGuarded(node.id)}
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
                    {isHighlighted && (
                      <rect
                        x={-4}
                        y={-4}
                        width={NODE_WIDTH + 8}
                        height={NODE_HEIGHT + 8}
                        rx={10}
                        fill="none"
                        stroke={colors.stroke}
                        strokeWidth={1.5 / transform.k}
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
                      strokeWidth={
                        (isActive || isHighlighted || (showFullGraph && queryActive && focused)
                          ? 1.6
                          : 1) / Math.max(0.6, transform.k)
                      }
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
          </g>
        </svg>
      </div>

      <footer className="flex items-center gap-3 px-4 h-10 border-t border-border text-xs text-muted-foreground shrink-0 overflow-x-auto">
        <LegendDot color="#3b82f6" label="Page" />
        <LegendDot color="#a855f7" label="Database" />
        <LegendDot color="#22c55e" label="Task" />
        <LegendDot color="#f59e0b" label="Note" />
        <span className="ml-auto text-[10px] text-muted-foreground/70">
          {Math.round(transform.k * 100)}%
        </span>
      </footer>
    </>
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
