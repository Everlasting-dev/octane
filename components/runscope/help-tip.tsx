"use client"

// "?" next to a section title: click / tap opens a short explanation of what
// the section is and how to use it; Esc or a click elsewhere closes it.

import { useEffect, useId, useRef, useState, type ReactNode } from "react"
import { HelpCircle } from "lucide-react"
import { cn } from "@/lib/utils"

export function HelpTip({
  title,
  children,
  align = "left",
  className,
}: {
  title: string
  children: ReactNode
  /** which side of the "?" the bubble opens towards */
  align?: "left" | "right"
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
  const id = useId()

  useEffect(() => {
    if (!open) return
    function onDown(e: PointerEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("pointerdown", onDown, true)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("pointerdown", onDown, true)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  return (
    <span ref={ref} className={cn("relative inline-flex normal-case tracking-normal", className)}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
        aria-label={`What is ${title}?`}
        aria-expanded={open}
        aria-controls={id}
        className={cn(
          "octane-help-tip inline-flex size-4 items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:text-foreground pointer-coarse:size-6",
          open && "text-primary",
        )}
      >
        <HelpCircle className="size-3.5" aria-hidden />
      </button>
      {open && (
        <span
          id={id}
          role="note"
          className={cn(
            "absolute top-full z-50 mt-1.5 w-64 max-w-[80vw] rounded-lg border border-border bg-popover p-3 text-left text-xs font-normal leading-relaxed text-foreground shadow-2xl",
            align === "left" ? "left-0" : "right-0",
          )}
        >
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</span>
          {children}
        </span>
      )}
    </span>
  )
}
