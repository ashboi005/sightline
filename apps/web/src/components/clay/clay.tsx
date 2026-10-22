import { cn } from "@sightline/ui/lib/utils";
import { CircleCheck, CircleDashed, LoaderCircle, TriangleAlert, type LucideIcon } from "lucide-react";

export type Tone = "plain" | "marigold" | "sage" | "lilac";

const surface: Record<Tone, string> = {
  plain: "clay",
  marigold: "clay-marigold",
  sage: "clay-sage",
  lilac: "clay-lilac",
};

/** A soft, raised card for workspace chrome. Don't put long reading content on tinted tones. */
export function ClayCard({
  tone = "plain",
  className,
  ...props
}: React.ComponentProps<"div"> & { tone?: Tone }) {
  return <div className={cn("rounded-[1.75rem]", surface[tone], className)} {...props} />;
}

const tile: Record<Tone, string> = {
  plain: "clay-sm text-foreground",
  marigold: "clay-marigold",
  sage: "clay-sage text-sage-ink",
  lilac: "clay-lilac text-lilac-ink",
};

/** A small clay square holding an icon. */
export function IconTile({
  icon: Icon,
  tone = "plain",
  size = "md",
  className,
}: {
  icon: LucideIcon;
  tone?: Tone;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const box = { sm: "size-8 rounded-xl", md: "size-10 rounded-[0.9rem]", lg: "size-14 rounded-[1.2rem]" }[size];
  const glyph = { sm: "size-4", md: "size-5", lg: "size-6" }[size];
  return (
    <span aria-hidden="true" className={cn("inline-flex shrink-0 items-center justify-center", box, tile[tone], className)}>
      <Icon className={glyph} />
    </span>
  );
}

export type StatusKind = "ready" | "working" | "attention" | "idle" | "live";

const statusStyle: Record<StatusKind, { icon: LucideIcon; className: string; spin?: boolean }> = {
  ready: { icon: CircleCheck, className: "bg-sage text-sage-ink" },
  working: { icon: LoaderCircle, className: "bg-lilac text-lilac-ink", spin: true },
  attention: { icon: TriangleAlert, className: "bg-destructive/12 text-destructive" },
  idle: { icon: CircleDashed, className: "bg-muted text-muted-foreground" },
  live: { icon: CircleDashed, className: "bg-live/12 text-live" },
};

/** Status as text + icon (never colour alone). */
export function StatusPill({
  kind,
  children,
  icon,
  className,
}: {
  kind: StatusKind;
  children: React.ReactNode;
  icon?: LucideIcon;
  className?: string;
}) {
  const style = statusStyle[kind];
  const Icon = icon ?? style.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold whitespace-nowrap",
        style.className,
        className,
      )}
    >
      {kind === "live" && !icon ? (
        <span className="relative flex size-2">
          <span className="absolute inset-0 animate-ping rounded-full bg-live opacity-50 motion-reduce:hidden" />
          <span className="relative size-2 rounded-full bg-live" />
        </span>
      ) : (
        <Icon aria-hidden="true" className={cn("size-3.5", style.spin && "animate-spin motion-reduce:animate-none")} />
      )}
      {children}
    </span>
  );
}

/** Page title with an optional icon tile, description and actions on the right. */
export function PageHeader({
  icon,
  tone = "marigold",
  title,
  description,
  actions,
  className,
}: {
  icon?: LucideIcon;
  tone?: Tone;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex flex-wrap items-start justify-between gap-4", className)}>
      <div className="flex min-w-0 items-start gap-4">
        {icon && <IconTile icon={icon} tone={tone} size="lg" className="hidden sm:inline-flex" />}
        <div className="min-w-0">
          <h1 className="text-[1.75rem] leading-tight font-extrabold tracking-[-0.025em] text-balance sm:text-[2.125rem]">
            {title}
          </h1>
          {description && <p className="mt-1.5 max-w-2xl text-base leading-relaxed text-muted-foreground">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function SectionTitle({ children, aside, className }: { children: React.ReactNode; aside?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-center justify-between gap-3", className)}>
      <h2 className="text-lg font-bold tracking-tight">{children}</h2>
      {aside}
    </div>
  );
}

/** An error with what to do next. */
export function InlineAlert({ children, action, className }: { children: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div role="alert" className={cn("flex flex-wrap items-center gap-3 rounded-2xl bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive", className)}>
      <TriangleAlert aria-hidden="true" className="size-4 shrink-0" />
      <p className="min-w-0 flex-1">{children}</p>
      {action}
    </div>
  );
}
