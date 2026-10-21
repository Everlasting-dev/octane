"use client"

// Drag-to-resize for the right-hand side panels (Lines, Analysis dock,
// Channels Values, Self check). Drag the left edge; double-click it to reset.
// Each panel remembers its own width.

import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react"
import { cn } from "@/lib/utils"

const KEY = (id: string) => `octane:panel-width:${id}`

function clampWidth(w: number, min: number, max: number) {
  const viewportMax = typeof window === "undefined" ? max : Math.max(min, window.innerWidth - 160)
  return Math.round(Math.min(Math.min(max, viewportMax), Math.max(min, w)))
}

export function usePanelWidth(id: string, initial: number, min: number, max: number) {
  const [width, setWidth] = useState(initial)
  useEffect(() => {
    try {
      const v = Number(window.localStorage.getItem(KEY(id)))
      if (Number.isFinite(v) && v > 0) setWidth(clampWidth(v, min, max))
    } catch {
      /* storage unavailable: default width */
    }
  }, [id, min, max])
  const save = useCallback(
    (w: number) => {
      try {
        window.localStorage.setItem(KEY(id), String(w))
      } catch {
        /* ignore */
      }
    },
    [id],
  )
  return { width, setWidth: (w: number) => setWidth(clampWidth(w, min, max)), save, reset: () => (setWidth(initial), save(initial)), min, max }
}

/** The grab strip on a right-hand panel's left edge (desktop only). */
export function ResizeHandle({
  panel,
  className,
  label = "Resize panel",
}: {
  panel: ReturnType<typeof usePanelWidth>
  className?: string
  label?: string
}) {
  const drag = useRef<{ x: number; w: number; last: number } | null>(null)
  const [active, setActive] = useState(false)

  function down(e: PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, w: panel.width, last: panel.width }
    setActive(true)
  }
  function move(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current
    if (!d) return
    // panel sits on the right: dragging left makes it wider
    const next = clampWidth(d.w + (d.x - e.clientX), panel.min, panel.max)
    d.last = next
    panel.setWidth(next)
  }
  function up(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current
    if (!d) return
    drag.current = null
    setActive(false)
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* already released */
    }
    panel.save(d.last)
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={panel.width}
      aria-valuemin={panel.min}
      aria-valuemax={panel.max}
      title={`${label}: drag, double-click to reset`}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onDoubleClick={(e) => {
        e.stopPropagation()
        panel.reset()
      }}
      className={cn(
        "octane-resize-handle group absolute inset-y-0 left-0 z-30 hidden w-2 cursor-col-resize touch-none sm:block",
        className,
      )}
    >
      <span
        className={cn(
          "absolute inset-y-0 left-0 w-px bg-transparent transition-colors group-hover:bg-primary/70",
          active && "w-0.5 bg-primary",
        )}
      />
    </div>
  )
}
