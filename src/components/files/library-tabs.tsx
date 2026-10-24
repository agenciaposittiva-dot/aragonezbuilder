import { Cloud, FolderOpen, Link2 } from "lucide-react";
import { SegmentedNav } from "@/components/ui/segmented-nav";

/** Abas da Biblioteca: arquivos enviados e referências por link. */
export function LibraryTabs({ base }: { base: string }) {
  return (
    <SegmentedNav
      className="self-start"
      items={[
        { label: "Arquivos", href: `${base}/files`, icon: <FolderOpen /> },
        { label: "Referências", href: `${base}/files/referencias`, icon: <Link2 /> },
        { label: "Google Drive", href: `${base}/files/google-drive`, icon: <Cloud /> },
      ]}
    />
  );
}
