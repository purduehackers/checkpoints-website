import type { SVGProps } from "react";
import { cn } from "./cn";

type GliderProps = SVGProps<SVGSVGElement> & {
  label?: string;
};

export function Glider({ label, className, ...rest }: GliderProps) {
  return (
    <svg
      viewBox="0 0 3 3"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("block size-6 shrink-0", className)}
      shapeRendering="crispEdges"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      {...rest}
    >
      <rect x="1" y="0" width="1" height="2" fill="var(--glider-a, currentColor)" />
      <rect x="2" y="1" width="1" height="2" fill="var(--glider-b, currentColor)" />
      <rect x="0" y="2" width="1" height="1" fill="var(--glider-c, currentColor)" />
    </svg>
  );
}
