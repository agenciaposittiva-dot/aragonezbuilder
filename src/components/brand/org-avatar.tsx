import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

/**
 * Logo da agência em formato compacto (menu, seletor, listas). Com logo, usa
 * fundo claro neutro para PNGs transparentes; sem logo, as iniciais.
 */
export function OrgAvatar({
  name,
  src,
  size = "md",
  className,
}: {
  name: string;
  src: string | null | undefined;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  className?: string;
}) {
  return (
    <Avatar
      name={name}
      src={src}
      square
      size={size}
      className={cn(src && "bg-white ring-1 ring-black/10 [&_img]:object-contain", className)}
    />
  );
}
