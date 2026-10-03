// Octane app mark (white rounded tile, navy turbo). Generated assets come from
// scripts/gen-icons.mjs; this component just shows public/logo-mark.png.
const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? ""

export function OctaneLogo({ className }: { className?: string }) {
  return (
    <img src={`${BASE}/logo-mark.png`} alt="" aria-hidden="true" draggable={false} className={className} />
  )
}
