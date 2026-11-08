"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { cn } from "./cn";
import { Icon } from "./icon";
import "./dialog.css";

type DialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  className?: string;
};

export function Dialog({ open, onOpenChange, title, children, className }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className={cn("ph-dialog", className)}
      onClose={() => onOpenChange(false)}
      onClick={(e) => {
        if (e.target === e.currentTarget) onOpenChange(false);
      }}
    >
      <div className="flex items-center justify-between gap-4 border-b border-foreground px-5 py-3">
        <h2 id={titleId} className="ph-subheadline text-[13px]">
          {title}
        </h2>
        <button type="button" aria-label="Close" onClick={() => onOpenChange(false)} className="-mr-1.5 cursor-pointer p-1.5 hover:bg-foreground/[0.08]">
          <Icon name="times" className="size-3.5" />
        </button>
      </div>
      <div className="flex flex-col gap-3 px-5 py-4 leading-[1.5]">{children}</div>
    </dialog>
  );
}
