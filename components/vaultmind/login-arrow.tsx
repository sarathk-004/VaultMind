import { cn } from "@/lib/utils"

export function LoginArrow({
  direction,
  className,
}: {
  direction: "left" | "right"
  className?: string
}) {
  return (
    <svg
      viewBox="0 0 36 36"
      aria-hidden
      className={cn("h-full w-full", className)}
    >
      <path
        d={
          direction === "left"
            ? "M22 6 10 18l12 12M10 18h20"
            : "M14 6l12 12-12 12M26 18H6"
        }
        fill="none"
        stroke="currentColor"
        strokeWidth="4.2"
        strokeLinecap="butt"
        strokeLinejoin="miter"
      />
    </svg>
  )
}
