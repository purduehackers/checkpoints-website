import type { InputHTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";
import "./checkbox.css";

type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  children?: ReactNode;
};

export function Checkbox({ children, className, ...rest }: CheckboxProps) {
  return (
    <label className={cn("inline-flex cursor-pointer items-center gap-2 leading-[1.35]", className)}>
      <input type="checkbox" className="ph-checkbox" {...rest} />
      {children}
    </label>
  );
}
