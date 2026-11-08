import type { InputHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "./cn";

const base =
  "w-full min-w-0 border border-input bg-card px-3 font-sans text-[15px] text-card-foreground outline-none transition-colors duration-150 ease-quint placeholder:text-card-foreground/55 focus-visible:border-foreground disabled:cursor-not-allowed disabled:opacity-40 aria-invalid:border-ph-orange";

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn("h-10", base, className)} {...rest} />;
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn("min-h-24 py-2", base, className)} {...rest} />;
}
