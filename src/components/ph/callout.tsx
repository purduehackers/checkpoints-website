import type { ReactNode } from "react";
import { cn } from "./cn";
import { Icon } from "./icon";
import type { IconName } from "./icons";

type CalloutProps = {
  title?: string;
  icon?: IconName;
  children: ReactNode;
  className?: string;
};

export function Callout({ title, icon = "info-circle", children, className }: CalloutProps) {
  return (
    <aside
      className={cn(
        "flex items-start gap-4 border-2 border-dashed border-ph-purple bg-ph-yellow/30 p-5 sm:p-6 dark:border-ph-yellow dark:bg-ph-purple/15",
        className,
      )}
    >
      <Icon name={icon} className="mt-0.5 size-6 text-ph-purple dark:text-ph-yellow" />
      <div className="flex flex-col gap-2">
        {title && <p className="font-pixel text-base uppercase sm:text-lg">{title}</p>}
        <div className="text-sm leading-[1.5] sm:text-base">{children}</div>
      </div>
    </aside>
  );
}
