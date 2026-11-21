"use client";

import { useState, type CSSProperties } from "react";
import { cn } from "./cn";
import { icons, type IconName } from "./icons";
import "./segmented-toggle.css";

type Option = {
  value: string;
  label: string;
  icon?: IconName;
};

type SegmentedToggleProps = {
  options: Option[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  label?: string;
  className?: string;
};

export function SegmentedToggle({ options, value, defaultValue, onValueChange, label, className }: SegmentedToggleProps) {
  const [inner, setInner] = useState(defaultValue ?? options[0]?.value);
  const current = value ?? inner;
  const index = Math.max(0, options.findIndex((o) => o.value === current));

  return (
    <div
      role="group"
      aria-label={label}
      className={cn("relative isolate grid w-fit shrink-0 auto-cols-fr grid-flow-col bg-foreground/[0.08] p-0.5", className)}
      style={{ "--count": options.length, "--index": index } as CSSProperties}
    >
      <span aria-hidden="true" className="ph-toggle__chip pointer-events-none absolute inset-y-0.5 left-0.5 -z-10 bg-background"/>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === current}
          aria-label={o.icon ? o.label : undefined}
          onClick={() => {
            if (o.value === current) return;
            setInner(o.value);
            onValueChange?.(o.value);
          }}
          className="flex min-w-8 cursor-pointer items-center justify-center px-2 py-1.5 transition-colors duration-200 ease-quint"
        >
          {o.icon ? (
            <svg viewBox="0 0 24 24" fill="currentColor" className="size-3.5" aria-hidden="true" dangerouslySetInnerHTML={{ __html: icons[o.icon] }} />
          ) : (
            o.label
          )}
        </button>
      ))}
    </div>
  );
}
