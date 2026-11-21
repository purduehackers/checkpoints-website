import type { AnchorHTMLAttributes, ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";
import { cn } from "./cn";
import { pixelOrder } from "./dither";
import "./dither-button.css";

type DitherButtonProps = {
  children: ReactNode;
  href?: string;
  tone?: "light" | "dark";
  cols?: number;
  rows?: number;
  className?: string;
  style?: CSSProperties;
} & Omit<AnchorHTMLAttributes<HTMLAnchorElement> & ButtonHTMLAttributes<HTMLButtonElement>, "children">;

export function DitherButton({
  children,
  href,
  tone,
  cols = 10,
  rows = 5,
  className,
  style,
  type = "button",
  ...rest
}: DitherButtonProps) {
  const inner = (
    <>
      <span className="ph-dither-btn__pixels" aria-hidden="true">
        {pixelOrder(cols * rows).map((i) => (
          <span key={i} className="ph-dither-btn__pixel" style={{ "--i": i } as CSSProperties} />
        ))}
      </span>
      <span className="ph-dither-btn__label">{children}</span>
    </>
  );
  const props = {
    "data-tone": tone,
    className: cn("ph-dither-btn", className),
    style: { "--cols": cols, ...style } as CSSProperties,
  };

  return href ? (
    <a href={href} {...props} {...(rest as AnchorHTMLAttributes<HTMLAnchorElement>)}>
      {inner}
    </a>
  ) : (
    <button type={type} {...props} {...(rest as ButtonHTMLAttributes<HTMLButtonElement>)}>
      {inner}
    </button>
  );
}
