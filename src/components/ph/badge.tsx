import type { ReactNode } from "react";
import { cn } from "./cn";

const colors = {
  default: "bg-foreground text-background",
  yellow: "bg-ph-yellow text-ph-black",
  purple: "bg-ph-purple text-ph-cream",
  pink: "bg-ph-pink text-ph-black",
  blue: "bg-ph-blue text-ph-cream",
  lime: "bg-ph-lime text-ph-black",
  teal: "bg-ph-teal text-ph-black",
  orange: "bg-ph-orange text-ph-black",
  outline: "border border-foreground text-foreground",
};

type BadgeProps = {
  children: ReactNode;
  color?: keyof typeof colors;
  className?: string;
};

export function Badge({ children, color = "default", className }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center gap-1 px-1.5 py-0.5 font-mono text-[11px] leading-none font-semibold tracking-wide uppercase",
        colors[color],
        className,
      )}
    >
      {children}
    </span>
  );
}
