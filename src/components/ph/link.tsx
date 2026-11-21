import type { AnchorHTMLAttributes, CSSProperties } from "react";
import { cn } from "./cn";
import "./link.css";

type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
  tint?: string;
};

export function Link({ href, tint, className, style, ...rest }: LinkProps) {
  const external = /^https?:\/\//.test(href);
  return (
    <a
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noopener noreferrer" : undefined}
      data-tint={tint ? "" : undefined}
      className={cn("ph-link", className)}
      style={tint ? ({ "--link": tint, ...style } as CSSProperties) : style}
      {...rest}
    />
  );
}
