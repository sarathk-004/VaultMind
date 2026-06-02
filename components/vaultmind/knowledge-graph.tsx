"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Maximize2, Minimize2, Network, ZoomIn, ZoomOut, Locate } from "lucide-react"
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

function GraphLoadingView() {
  const words = [
    "Knowledge is loading...",
    "Knowledge is mapping...",
    "Knowledge is connecting...",
    "Knowledge is clustering...",
    "Knowledge is almost here...",
  ]
  const [index, setIndex] = useState(0)

  useEffect(() => {
    const timer = setInterval(() => {
      setIndex(prev => (prev + 1) % words.length)
    }, 1500)
    return () => clearInterval(timer)
  }, [])

  return (
    <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-sidebar/85 backdrop-blur-md transition-all duration-300">
      {/* background network animation */}
      <div className="absolute inset-0 opacity-40 pointer-events-none">
        <svg viewBox="0 0 100 100" className="h-full w-full stroke-muted-foreground/20 fill-none" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none">
          <path d="M10 10 L30 45 L50 60 L75 50 L90 55" className="stroke-muted-foreground/35 fill-none stroke-[0.3] animate-pulse" style={{ animationDuration: '4s' }} />
          <path d="M15 15 L35 25 L50 15 L70 30 L85 20" className="stroke-muted-foreground/35 fill-none stroke-[0.3] animate-pulse" style={{ animationDuration: '3s', animationDelay: '1s' }} />
          <path d="M20 85 L40 75 L60 80 L80 70 L95 85" className="stroke-muted-foreground/35 fill-none stroke-[0.3] animate-pulse" style={{ animationDuration: '4.5s', animationDelay: '0.5s' }} />
          <path d="M30 45 L35 25 L40 75" className="stroke-muted-foreground/35 fill-none stroke-[0.3] animate-pulse" style={{ animationDuration: '3.5s', animationDelay: '1.5s' }} />
          <path d="M50 60 L50 15 L60 80" className="stroke-muted-foreground/35 fill-none stroke-[0.3] animate-pulse" style={{ animationDuration: '4.2s', animationDelay: '2s' }} />
          <path d="M70 30 L75 50 L80 70" className="stroke-muted-foreground/35 fill-none stroke-[0.3] animate-pulse" style={{ animationDuration: '5s', animationDelay: '2.5s' }} />
        </svg>

        {/* flickering pixels */}
        <span className="absolute h-2 w-2 rounded-full bg-[#CECBF6] animate-ping" style={{ left: "15%", top: "15%", animationDuration: "3s" }} />
        <span className="absolute h-1.5 w-1.5 rounded-full bg-[#D9592A] animate-ping" style={{ left: "35%", top: "25%", animationDuration: "2.5s" }} />
        <span className="absolute h-2 w-2 rounded-full bg-[#FAFAFA] animate-ping" style={{ left: "50%", top: "15%", animationDuration: "4s" }} />
        <span className="absolute h-1.5 w-1.5 rounded-full bg-[#CECBF6] animate-ping" style={{ left: "70%", top: "30%", animationDuration: "3.5s" }} />
        <span className="absolute h-2 w-2 rounded-full bg-[#D9592A] animate-ping" style={{ left: "85%", top: "20%", animationDuration: "2.8s" }} />

        <span className="absolute h-1.5 w-1.5 rounded-full bg-[#FAFAFA] animate-ping" style={{ left: "10%", top: "50%", animationDuration: "3.2s" }} />
        <span className="absolute h-2 w-2 rounded-full bg-[#CECBF6] animate-ping" style={{ left: "30%", top: "45%", animationDuration: "2.2s" }} />
        <span className="absolute h-1.5 w-1.5 rounded-full bg-[#D9592A] animate-ping" style={{ left: "50%", top: "60%", animationDuration: "3.8s" }} />
        <span className="absolute h-2.5 w-2.5 rounded-full bg-[#FAFAFA] animate-ping" style={{ left: "75%", top: "50%", animationDuration: "2.9s" }} />
        <span className="absolute h-1.5 w-1.5 rounded-full bg-[#CECBF6] animate-ping" style={{ left: "90%", top: "55%", animationDuration: "3.4s" }} />

        <span className="absolute h-2 w-2 rounded-full bg-[#D9592A] animate-ping" style={{ left: "20%", top: "85%", animationDuration: "3.6s" }} />
        <span className="absolute h-1.5 w-1.5 rounded-full bg-[#FAFAFA] animate-ping" style={{ left: "40%", top: "75%", animationDuration: "2.4s" }} />
        <span className="absolute h-2 w-2 rounded-full bg-[#CECBF6] animate-ping" style={{ left: "60%", top: "80%", animationDuration: "4.2s" }} />
        <span className="absolute h-1.5 w-1.5 rounded-full bg-[#D9592A] animate-ping" style={{ left: "80%", top: "70%", animationDuration: "3.1s" }} />
        <span className="absolute h-2 w-2 rounded-full bg-[#FAFAFA] animate-ping" style={{ left: "95%", top: "85%", animationDuration: "2.7s" }} />
      </div>

      <div className="relative z-10 flex flex-col items-center gap-3.5 px-6 text-center select-none">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary/15">
          <Network className="h-6 w-6 text-[#CECBF6] animate-pulse" />
        </div>
        <h3 className="text-base font-semibold tracking-tight text-foreground/90 transition-all duration-300 min-w-[240px]">
          {words[index]}
        </h3>
        <p className="text-[11px] text-muted-foreground/75 max-w-[200px] leading-normal">
          connecting thoughts and mapping ideas live...
        </p>
      </div>
    </div>
  )
}

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
  const [panelWidth, setPanelWidth] = useState(420)

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = panelWidth
    const onMouseMove = (moveEvent: MouseEvent) => {
      const delta = startX - moveEvent.clientX
      // Clamp between 300px and 750px
      const nextWidth = Math.max(300, Math.min(750, startWidth + delta))
      setPanelWidth(nextWidth)
    }
    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove)
      document.removeEventListener("mouseup", onMouseUp)
    }
    document.addEventListener("mousemove", onMouseMove)
    document.addEventListener("mouseup", onMouseUp)
  }

  return (
    <>
      <aside
        className={
          "flex flex-col h-full w-full lg:w-[var(--panel-width)] lg:shrink-0 lg:border-l border-border bg-sidebar relative " +
          (props.className ?? "")
        }
        style={{ "--panel-width": `${panelWidth}px` } as React.CSSProperties}
      >
        {/* Resize Handle */}
        <div
          className="hidden lg:block absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-primary/40 active:bg-primary z-50 transition-colors"
          onMouseDown={handleMouseDown}
        />
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
    // Keep enough room for labels without making sparse pages feel marooned.
    const PER_NODE_AREA = 220 * 220
    const totalArea = n * PER_NODE_AREA
    const side = Math.sqrt(totalArea) * 1.25
    const h = Math.max(620, side)
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

  const densestNodeId = useMemo(() => {
    let bestId: string | null = null
    let bestDegree = -1
    for (const node of positionedNodes) {
      const degree = adjacency.get(node.id)?.size ?? 0
      if (degree > bestDegree) {
        bestId = node.id
        bestDegree = degree
      }
    }
    return bestId
  }, [adjacency, positionedNodes])

  const locateTargetIds = useMemo(() => {
    if (highlightedNodeId) return [highlightedNodeId, ...Array.from(adjacency.get(highlightedNodeId) ?? [])]
    if (showFullGraph && queryActive) return Array.from(focusedNodeIds)
    if (densestNodeId) return [densestNodeId, ...Array.from(adjacency.get(densestNodeId) ?? [])]
    return []
  }, [adjacency, densestNodeId, focusedNodeIds, highlightedNodeId, queryActive, showFullGraph])

  const locateLabel = highlightedNodeId
    ? "Relocate to active node"
    : showFullGraph && queryActive
      ? "Relocate to active nodes"
      : "Relocate to densest area"

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

  const computeTransformForNodes = useCallback(
    (ids: string[], opts?: { minZoom?: number; maxZoom?: number; padding?: number }) => {
      const targets = ids
        .map(id => positionMap.get(id))
        .filter((node): node is PositionedNode => Boolean(node))

      if (targets.length === 0) return null

      const minX = Math.min(...targets.map(node => node.x - NODE_WIDTH / 2))
      const maxX = Math.max(...targets.map(node => node.x + NODE_WIDTH / 2))
      const minY = Math.min(...targets.map(node => node.y - NODE_HEIGHT / 2))
      const maxY = Math.max(...targets.map(node => node.y + NODE_HEIGHT / 2))
      const width = Math.max(maxX - minX, NODE_WIDTH)
      const height = Math.max(maxY - minY, NODE_HEIGHT)
      const padding = opts?.padding ?? (targets.length === 1 ? 180 : 130)
      const fit = Math.min(size.width / (width + padding), size.height / (height + padding), opts?.maxZoom ?? MAX_ZOOM)
      const k = Math.min(opts?.maxZoom ?? MAX_ZOOM, Math.max(opts?.minZoom ?? MIN_ZOOM, fit))
      const cx = (minX + maxX) / 2
      const cy = (minY + maxY) / 2

      return {
        k,
        x: size.width / 2 - cx * k,
        y: size.height / 2 - cy * k,
      }
    },
    [positionMap, size.height, size.width],
  )

  const nodeOpacity = (id: string) => {
    if (activeId) {
      if (id === activeId) return 1
      if (activeNeighbors.has(id)) return 0.95
      return isFocused(id) ? 0.64 : 0.34
    }
    if (showFullGraph && queryActive) return isFocused(id) ? 1 : 0.62
    return 0.96
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
    type: "pan" | "node" | "pinch" | null
    nodeId?: string
    startPointerId?: number
    startClientX: number
    startClientY: number
    startNodeX?: number
    startNodeY?: number
    startTx?: number
    startTy?: number
    startK?: number
    startDistance?: number
    startWorldX?: number
    startWorldY?: number
    moved?: boolean
  }>({ type: null, startClientX: 0, startClientY: 0 })
  const activePointersRef = useRef<Map<number, { clientX: number; clientY: number }>>(new Map())

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

  const beginPinchIfReady = useCallback(() => {
    const pointers = Array.from(activePointersRef.current.values())
    if (pointers.length < 2) return false
    const [a, b] = pointers
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return false
    const centerX = (a.clientX + b.clientX) / 2 - rect.left
    const centerY = (a.clientY + b.clientY) / 2 - rect.top
    const distance = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY) || 1
    interactionRef.current = {
      type: "pinch",
      startClientX: centerX,
      startClientY: centerY,
      startK: transform.k,
      startDistance: distance,
      startWorldX: (centerX - transform.x) / transform.k,
      startWorldY: (centerY - transform.y) / transform.k,
      moved: false,
    }
    return true
  }, [transform])

  const onBackgroundPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return
    activePointersRef.current.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY })
    e.currentTarget.setPointerCapture?.(e.pointerId)
    if (beginPinchIfReady()) return
    interactionRef.current = {
      type: "pan",
      startPointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startTx: transform.x,
      startTy: transform.y,
      moved: false,
    }
  }

  const onNodePointerDown = (e: React.PointerEvent, nodeId: string) => {
    e.stopPropagation()
    if (e.pointerType === "mouse" && e.button !== 0) return
    activePointersRef.current.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY })
    containerRef.current?.setPointerCapture?.(e.pointerId)
    if (beginPinchIfReady()) return
    const node = positionMap.get(nodeId)
    if (!node) return
    interactionRef.current = {
      type: "node",
      nodeId,
      startPointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startNodeX: node.x,
      startNodeY: node.y,
      moved: false,
    }
  }

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!activePointersRef.current.has(e.pointerId)) return
      activePointersRef.current.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY })
      const it = interactionRef.current
      if (!it.type) return
      if (it.type === "pinch") {
        const pointers = Array.from(activePointersRef.current.values())
        if (pointers.length < 2) return
        const [a, b] = pointers
        const rect = containerRef.current?.getBoundingClientRect()
        if (!rect) return
        const centerX = (a.clientX + b.clientX) / 2 - rect.left
        const centerY = (a.clientY + b.clientY) / 2 - rect.top
        const distance = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY) || 1
        const ratio = distance / (it.startDistance || distance)
        const newK = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, (it.startK || transform.k) * ratio))
        setTransform({
          k: newK,
          x: centerX - (it.startWorldX || 0) * newK,
          y: centerY - (it.startWorldY || 0) * newK,
        })
        it.moved = true
        return
      }

      if (it.startPointerId !== e.pointerId) return
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
    const onUp = (e: PointerEvent) => {
      const it = interactionRef.current
      const shouldOpenNode =
        it.type === "node" &&
        it.startPointerId === e.pointerId &&
        it.nodeId &&
        !it.moved
      activePointersRef.current.delete(e.pointerId)
      if (shouldOpenNode) {
        onNodeClick(it.nodeId!)
      }
      if (activePointersRef.current.size >= 2) {
        beginPinchIfReady()
        return
      }
      interactionRef.current = { type: null, startClientX: 0, startClientY: 0 }
    }
    window.addEventListener("pointermove", onMove, { passive: false })
    window.addEventListener("pointerup", onUp)
    window.addEventListener("pointercancel", onUp)
    return () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      window.removeEventListener("pointercancel", onUp)
    }
  }, [beginPinchIfReady, onNodeClick, transform.k])

  // Computes a zoom level that fits, but clamps to a readable minimum so the
  // side panel doesn't end up at 8% zoom when there are 100+ nodes — instead
  // the user pans to navigate. Fullscreen uses the true fit value.
  const computeFitTransform = useCallback(() => {
    const fit = Math.min(size.width / virtualSize.w, size.height / virtualSize.h, 1)
    const k = Math.min(0.9, Math.max(fit, fullscreen ? 0.52 : 0.55))
    return {
      k,
      x: (size.width - virtualSize.w * k) / 2,
      y: (size.height - virtualSize.h * k) / 2,
    }
  }, [size.width, size.height, virtualSize.w, virtualSize.h, fullscreen])

  // Re-center on graph change
  const lastGraphKey = useRef<string>("")
  useEffect(() => {
    const renderKey = (renderGraph?.nodes ?? []).map(n => n.id).join("|")
    const focusedKey = Array.from(focusedNodeIds).join("|")
    const locateKey = locateTargetIds.join("|")
    const key = `${renderKey}::focused=${focusedKey}::locate=${locateKey}::fullscreen=${fullscreen}`
    if (key === lastGraphKey.current) return
    lastGraphKey.current = key
    if (!renderGraph || renderGraph.nodes.length === 0) return
    const locateTransform = locateTargetIds.length
      ? computeTransformForNodes(locateTargetIds, {
          minZoom: fullscreen ? 0.48 : 0.65,
          maxZoom: fullscreen ? 1.6 : 1.35,
          padding: locateTargetIds.length <= 1 ? 180 : fullscreen ? 220 : 130,
        })
      : null
    const focusedTransform = queryActive
      ? computeTransformForNodes(Array.from(focusedNodeIds), {
          minZoom: fullscreen ? 0.18 : 0.24,
          maxZoom: fullscreen ? 1.45 : 1.25,
          padding: fullscreen ? 220 : 150,
        })
      : null
    setTransform(locateTransform ?? focusedTransform ?? computeFitTransform())
  }, [computeFitTransform, computeTransformForNodes, focusedNodeIds, fullscreen, locateTargetIds, queryActive, renderGraph])

  const recenter = () => {
    if (!renderGraph || renderGraph.nodes.length === 0) return
    setTransform(computeFitTransform())
    setDragOverrides(new Map())
  }

  const relocateToActive = () => {
    if (!renderGraph || renderGraph.nodes.length === 0) return
    const nextTransform = computeTransformForNodes(locateTargetIds, {
      minZoom: fullscreen ? 0.48 : 0.65,
      maxZoom: fullscreen ? 1.6 : 1.35,
      padding: locateTargetIds.length <= 1 ? 180 : fullscreen ? 220 : 130,
    })

    if (!nextTransform) {
      recenter()
      return
    }
    setTransform(nextTransform)
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

  const totalNodes = renderGraph?.nodes.length ?? 0
  const totalEdges = renderGraph?.edges.length ?? 0

  const isEmpty = !workspaceLoading && (!renderGraph || renderGraph.nodes.length === 0)

  return (
    <>
      <header className="flex items-center justify-between px-4 h-14 border-b border-border shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Network className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden />
          <h2 className="text-sm font-medium tracking-tight">Knowledge Graph</h2>
        </div>
        <div className="flex items-center gap-1 pr-8 lg:pr-0">
          <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-slate-100 dark:hover:bg-slate-800/60 hover:text-foreground active:bg-slate-200 dark:active:bg-slate-700/80 focus:outline-none focus:ring-2 focus:ring-slate-400/40" onClick={() => zoomBy(1.2)} aria-label="Zoom in">
            <ZoomIn className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-slate-100 dark:hover:bg-slate-800/60 hover:text-foreground active:bg-slate-200 dark:active:bg-slate-700/80 focus:outline-none focus:ring-2 focus:ring-slate-400/40" onClick={() => zoomBy(1 / 1.2)} aria-label="Zoom out">
            <ZoomOut className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 hover:bg-slate-100 dark:hover:bg-slate-800/60 hover:text-foreground active:bg-slate-200 dark:active:bg-slate-700/80 focus:outline-none focus:ring-2 focus:ring-slate-400/40"
            onClick={relocateToActive}
            aria-label={locateLabel}
            title={locateLabel}
            data-tour="graph-locate"
          >
            <Locate className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 hover:bg-slate-100 dark:hover:bg-slate-800/60 hover:text-foreground active:bg-slate-200 dark:active:bg-slate-700/80 focus:outline-none focus:ring-2 focus:ring-slate-400/40"
            onClick={onToggleFullscreen}
            aria-label={fullscreen ? "Close fullscreen" : "Expand graph"}
          >
            {fullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </header>

      <div
        ref={containerRef}
        className="relative flex-1 graph-grid overflow-hidden select-none touch-none"
        style={{ cursor: interactionRef.current.type === "pan" ? "grabbing" : "grab" }}
        onPointerDown={onBackgroundPointerDown}
        onPointerLeave={e => {
          if (e.pointerType === "mouse") setHoveredId(null)
        }}
      >
        {workspaceLoading && (
          <GraphLoadingView />
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

        {!isEmpty && !workspaceLoading && (
          <div className="pointer-events-none sticky top-3 z-10 mx-auto flex w-fit">
            <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/80 bg-background/70 backdrop-blur-sm px-2.5 py-1 rounded border border-border/60">
              Drag · pinch or scroll to zoom · ask to focus
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

                // Visually distinguish edge kinds:
                //   contains      → solid (parent/child, structural)
                //   references    → solid lighter (explicit @mention / link)
                //   relates to    → dashed (semantic similarity)
                const isSemantic = edge.relation === "relates to"
                return (
                  <path
                    key={`edge-${idx}`}
                    d={path}
                    fill="none"
                    stroke={
                      active
                        ? "var(--graph-edge-active)"
                        : focused && showFullGraph && queryActive
                        ? "var(--graph-edge-focused)"
                        : isSemantic
                        ? "var(--graph-edge-semantic)"
                        : "var(--graph-edge)"
                    }
                    strokeWidth={(active ? 1.5 : isSemantic ? 0.75 : 1) / transform.k}
                    strokeOpacity={
                      edgeOpacity(edge.from, edge.to) * (isSemantic ? 0.7 : 1)
                    }
                    strokeDasharray={isSemantic ? `${4 / transform.k} ${4 / transform.k}` : undefined}
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
                    onPointerEnter={e => {
                      if (e.pointerType === "mouse") setHoveredId(node.id)
                    }}
                    onPointerLeave={e => {
                      if (e.pointerType === "mouse") setHoveredId(null)
                    }}
                    onPointerDown={e => onNodePointerDown(e, node.id)}
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
        <span className="font-medium text-foreground/80">{totalNodes} nodes</span>
        <span className="h-1 w-1 rounded-full bg-muted-foreground/50" aria-hidden />
        <span className="font-medium text-foreground/80">{totalEdges} links</span>
        <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-muted-foreground/70">
          <ZoomIn className="h-3 w-3" aria-hidden />
          {Math.round(transform.k * 100)}%
        </span>
      </footer>
    </>
  )
}
