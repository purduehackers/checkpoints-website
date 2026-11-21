import { cn } from "./cn";
import "./skeleton.css";

export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cn("ph-skeleton", className)} />;
}
