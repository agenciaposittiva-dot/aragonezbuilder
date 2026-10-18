"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PhotoEditor, postPhoto } from "@/components/brand/photo-editor";
import { Avatar } from "@/components/ui/avatar";

/**
 * "Foto de perfil" da pessoa logada (a conta vem sempre da sessão). Depois de
 * salvar, atualiza a página para o menu e os demais avatares mostrarem a foto.
 */
export function ProfilePhotoEditor({ name, src, maxBytes }: { name: string; src: string | null; maxBytes: number }) {
  const router = useRouter();
  const [current, setCurrent] = useState(src);
  // Nova foto vinda do servidor (após router.refresh): passa a ser a atual.
  const [lastSrc, setLastSrc] = useState(src);
  if (lastSrc !== src) {
    setLastSrc(src);
    setCurrent(src);
  }
  return (
    <PhotoEditor
      current={current}
      placeholder={<Avatar name={name} size="xl" className="size-24 text-2xl" />}
      alt={`Foto de ${name}`}
      maxBytes={maxBytes}
      variant="avatar"
      testId="profile-photo"
      labels={{
        saved: "Foto de perfil salva",
        removed: "Foto de perfil removida",
        kept: "A foto anterior foi mantida.",
        removeTitle: "Remover a foto de perfil?",
        removeDescription: "No lugar da foto passam a aparecer as suas iniciais. Você pode enviar outra quando quiser.",
        dialogDescription: "Arraste para posicionar e use o zoom para enquadrar o rosto no círculo.",
        where: "A foto é enquadrada em um quadrado e aparece redonda no menu, no chat, nos comentários e nas tarefas.",
      }}
      upload={(file, crop) => postPhoto("/api/user-avatar", {}, file, crop, "Imagem grande demais para a foto.")}
      remove={async () => {
        const res = await fetch("/api/user-avatar", { method: "DELETE" });
        const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
        if (!res.ok || !json?.ok) throw new Error(json?.error ?? "Não foi possível remover a foto.");
      }}
      onChange={(next) => {
        setCurrent(next);
        router.refresh();
      }}
    />
  );
}
