import type { ReactNode } from "react";
import { cn } from "./cn";

type CardProps = {
  children?: ReactNode;
  href?: string;
  title?: string;
  media?: ReactNode;
  /** Border color utility; replaces the default border-border (cn() can't merge overrides). */
  border?: string;
  className?: string;
};

export function Card({ children, href, title, media, border = "border-border", className }: CardProps) {
  const classes = cn(
    "flex flex-col gap-3 border bg-card p-5 text-card-foreground no-underline",
    border,
    href && "transition-colors duration-150 ease-quint hover:border-foreground",
    className,
  );
  const inner = (
    <>
      {media && <div className="-mx-5 -mt-5 border-b border-border">{media}</div>}
      {title && <h3 className="ph-headline text-3xl">{title}</h3>}
      <div className="flex flex-col gap-2 leading-[1.45]">{children}</div>
    </>
  );

  if (!href) return <div className={classes}>{inner}</div>;
  const external = /^https?:\/\//.test(href);
  return (
    <a href={href} target={external ? "_blank" : undefined} rel={external ? "noopener noreferrer" : undefined} className={classes}>
      {inner}
    </a>
  );
}
