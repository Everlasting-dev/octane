"use client"

import { cn } from "@/lib/utils"

interface ToggleProps {
  pressed: boolean
  onPressedChange: (v: boolean) => void
  label: string
}

export function Toggle({ pressed, onPressedChange, label }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={pressed}
      onClick={() => onPressedChange(!pressed)}
      className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5 text-sm transition-colors hover:bg-secondary"
    >
      <span
        className={cn(
          "relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors",
          pressed ? "bg-primary" : "bg-muted-foreground/40",
        )}
      >
        <span
          className={cn(
            "absolute size-3 rounded-full bg-background shadow transition-transform",
            pressed ? "translate-x-3.5" : "translate-x-0.5",
          )}
        />
      </span>
      <span className={cn(pressed ? "text-foreground" : "text-muted-foreground")}>{label}</span>
    </button>
  )
}
