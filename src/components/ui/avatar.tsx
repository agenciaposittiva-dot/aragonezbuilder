import { cn, initials } from "@/lib/utils";

const PALETTE = [
  "bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-200",
  "bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-200",
  "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200",
  "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200",
  "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-200",
  "bg-teal-100 text-teal-700 dark:bg-teal-500/20 dark:text-teal-200",
];

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function Avatar({
  name,
  src,
  size = "md",
  className,
  square,
}: {
  name: string | null | undefined;
  src?: string | null;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  className?: string;
  square?: boolean;
}) {
  const dims = {
    xs: "size-5 text-[9px]",
    sm: "size-6 text-[10px]",
    md: "size-8 text-xs",
    lg: "size-10 text-sm",
    xl: "size-14 text-base",
  }[size];
  const color = PALETTE[hash(name ?? "") % PALETTE.length];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden font-semibold select-none",
        square ? "rounded-md" : "rounded-full",
        dims,
        !src && color,
        className,
      )}
      title={name ?? undefined}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="size-full object-cover" />
      ) : (
        initials(name)
      )}
    </span>
  );
}

export function AvatarGroup({
  people,
  max = 4,
  size = "sm",
}: {
  people: { name: string | null; image?: string | null }[];
  max?: number;
  size?: "xs" | "sm" | "md";
}) {
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;
  return (
    <span className="flex -space-x-1.5">
      {shown.map((p, i) => (
        <Avatar key={i} name={p.name} src={p.image} size={size} className="ring-2 ring-surface" />
      ))}
      {rest > 0 ? (
        <span className="inline-flex size-6 items-center justify-center rounded-full bg-surface-3 text-[10px] font-semibold text-fg-muted ring-2 ring-surface">
          +{rest}
        </span>
      ) : null}
    </span>
  );
}
