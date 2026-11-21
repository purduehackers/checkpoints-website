import type { SVGProps } from "react";
import { cn } from "./cn";
import { icons, type IconName } from "./icons";

type IconProps = SVGProps<SVGSVGElement> & {
  name: IconName;
  label?: string;
};

export function Icon({ name, label, className, ...rest }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      shapeRendering="crispEdges"
      className={cn("size-4 shrink-0", className)}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      {...rest}
      dangerouslySetInnerHTML={{ __html: icons[name] }}
    />
  );
}
