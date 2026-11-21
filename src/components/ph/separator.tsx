import { cn } from "./cn";

type SeparatorProps = {
  label?: string;
  className?: string;
};

export function Separator({ label, className }: SeparatorProps) {
  return label ? (
    <div role="separator" className={cn("flex items-center gap-2", className)}>
      <span className="font-mono text-[11px] leading-none tracking-wide uppercase">{label}</span>
      <span className="h-px flex-1 bg-foreground" />
    </div>
  ) : (
    <div role="separator" className={cn("h-px w-full bg-border", className)} />
  );
}
