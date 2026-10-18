import {
  File,
  FileArchive,
  FileAudio,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileType2,
  FileVideo,
  Presentation,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

const ICONS = {
  file: File,
  image: FileImage,
  video: FileVideo,
  audio: FileAudio,
  text: FileText,
  sheet: FileSpreadsheet,
  slides: Presentation,
  archive: FileArchive,
  font: FileType2,
} satisfies Record<string, LucideIcon>;

export function iconKind(mime: string | null | undefined): keyof typeof ICONS {
  if (!mime) return "file";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.includes("spreadsheet") || mime.includes("excel") || mime === "text/csv") return "sheet";
  if (mime.includes("presentation") || mime.includes("powerpoint")) return "slides";
  if (
    mime === "application/pdf" ||
    mime.startsWith("text/") ||
    mime.includes("wordprocessing") ||
    mime === "application/msword"
  )
    return "text";
  if (mime.includes("zip")) return "archive";
  if (mime.startsWith("font/")) return "font";
  return "file";
}

export function extensionLabel(mime: string | null | undefined, name?: string) {
  const fromName = name?.split(".").pop();
  if (fromName && fromName.length <= 5 && fromName !== name) return fromName.toUpperCase();
  if (!mime) return "ARQ";
  return (mime.split("/").pop() ?? "ARQ").split(/[.+-]/).pop()!.slice(0, 4).toUpperCase();
}

export function FileIcon({ mime, className }: { mime: string | null | undefined; className?: string }) {
  const Icon = ICONS[iconKind(mime)];
  return <Icon className={cn("size-5 text-fg-subtle", className)} aria-hidden="true" />;
}

export function fileUrl(versionId: string, opts: { download?: boolean; thumb?: boolean } = {}) {
  const qs = opts.thumb ? "?thumb=1" : opts.download ? "?download=1" : "";
  return `/api/files/${versionId}${qs}`;
}
