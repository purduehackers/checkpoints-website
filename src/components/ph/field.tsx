import type { ReactNode } from "react";
import { cn } from "./cn";
import { Icon } from "./icon";

type FieldProps = {
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  className?: string;
};

export function Field({ label, htmlFor, hint, error, children, className }: FieldProps) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className="ph-subheadline text-[12px]">
        {label}
      </label>
      {children}
      {error ? (
        <p className="flex items-center gap-1.5 text-[13px]">
          <Icon name="exclamation-triangle" className="size-3.5 text-ph-orange" />
          {error}
        </p>
      ) : (
        hint && <p className="text-[13px]">{hint}</p>
      )}
    </div>
  );
}
