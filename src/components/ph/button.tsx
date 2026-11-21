import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";
import { Icon } from "./icon";
import type { IconName } from "./icons";

const variants = {
  solid: "bg-foreground text-background hover:bg-primary hover:text-primary-foreground",
  outline: "border border-foreground text-foreground hover:bg-foreground hover:text-background",
  ghost: "text-foreground hover:bg-foreground/[0.08]",
  orange: "bg-ph-orange text-ph-black hover:bg-ph-yellow",
  lime: "bg-ph-lime text-ph-black hover:bg-ph-yellow",
  "lime-outline": "border border-ph-lime text-ph-lime hover:bg-ph-lime hover:text-ph-black",
  "pink-outline": "border border-ph-pink text-ph-pink hover:bg-ph-pink hover:text-ph-black",
  link: "h-auto gap-1.5 px-0 font-sans font-normal tracking-normal normal-case underline underline-offset-2 hover:text-ph-yellow",
};

const sizes = {
  sm: "h-8 gap-1.5 px-3 text-[13px]",
  md: "h-10 gap-2 px-4 text-[15px]",
  lg: "h-[52px] gap-2.5 px-6 text-xl",
  icon: "size-10 p-0",
  "icon-lg": "size-[52px] p-0 [&_svg]:size-6",
};

type ButtonProps = {
  children?: ReactNode;
  href?: string;
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
  icon?: IconName;
  iconEnd?: IconName;
  className?: string;
} & Omit<AnchorHTMLAttributes<HTMLAnchorElement> & ButtonHTMLAttributes<HTMLButtonElement>, "children">;

export function Button({ children, href, variant = "solid", size = "md", icon, iconEnd, className, type = "button", ...rest }: ButtonProps) {
  const classes = cn(
    "inline-flex shrink-0 cursor-pointer items-center justify-center whitespace-nowrap transition-[color,background-color,transform] duration-150 ease-quint active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40",
    !size.startsWith("icon") && "w-fit",
    variant !== "link" && "font-mono font-semibold tracking-wide uppercase no-underline",
    variants[variant],
    variant !== "link" && sizes[size],
    className,
  );
  const inner = (
    <>
      {icon && <Icon name={icon} />}
      {children}
      {iconEnd && <Icon name={iconEnd} />}
    </>
  );

  return href ? (
    <a href={href} className={classes} {...(rest as AnchorHTMLAttributes<HTMLAnchorElement>)}>
      {inner}
    </a>
  ) : (
    <button type={type} className={classes} {...(rest as ButtonHTMLAttributes<HTMLButtonElement>)}>
      {inner}
    </button>
  );
}
