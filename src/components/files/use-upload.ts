"use client";

import { useCallback, useState } from "react";

export type UploadTarget = {
  fileId?: string | null;
  clientId?: string | null;
  projectId?: string | null;
  taskId?: string | null;
  requestId?: string | null;
  folderId?: string | null;
  category?: string;
  tags?: string[];
  note?: string | null;
};

export type UploadItem = {
  id: string;
  file: File;
  progress: number;
  status: "queued" | "uploading" | "done" | "error";
  error?: string;
};

type UploadResponse = { ok: boolean; error?: string; results?: { ok: boolean; error?: string }[] };

/** Envia arquivos para /api/uploads um a um, com progresso real (XHR). */
export function useUpload(orgSlug: string) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const [busy, setBusy] = useState(false);

  const add = useCallback((files: File[]) => {
    setItems((prev) => [
      ...prev,
      ...files.map((file) => ({
        id: `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`,
        file,
        progress: 0,
        status: "queued" as const,
      })),
    ]);
  }, []);

  const remove = useCallback((id: string) => setItems((prev) => prev.filter((i) => i.id !== id)), []);
  const reset = useCallback(() => setItems([]), []);

  const sendOne = (item: UploadItem, target: UploadTarget) =>
    new Promise<boolean>((resolve) => {
      const form = new FormData();
      form.set("orgSlug", orgSlug);
      form.append("file", item.file, item.file.name);
      for (const [k, v] of Object.entries(target)) {
        if (v === null || v === undefined || v === "") continue;
        form.set(k, Array.isArray(v) ? v.join(",") : String(v));
      }
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/uploads");
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const progress = Math.round((e.loaded / e.total) * 100);
          setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, progress, status: "uploading" } : i)));
        }
      };
      xhr.onload = () => {
        let res: UploadResponse = { ok: false };
        try {
          res = JSON.parse(xhr.responseText) as UploadResponse;
        } catch {}
        const ok = xhr.status < 300 && res.ok;
        setItems((prev) =>
          prev.map((i) =>
            i.id === item.id
              ? {
                  ...i,
                  progress: 100,
                  status: ok ? "done" : "error",
                  error: ok ? undefined : (res.error ?? res.results?.[0]?.error ?? "Falha no envio"),
                }
              : i,
          ),
        );
        resolve(ok);
      };
      xhr.onerror = () => {
        setItems((prev) =>
          prev.map((i) => (i.id === item.id ? { ...i, status: "error", error: "Falha de conexão" } : i)),
        );
        resolve(false);
      };
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, status: "uploading" } : i)));
      xhr.send(form);
    });

  const upload = useCallback(
    async (target: UploadTarget) => {
      setBusy(true);
      const queue = items.filter((i) => i.status === "queued" || i.status === "error");
      let done = 0;
      for (const item of queue) if (await sendOne(item, target)) done++;
      setBusy(false);
      return { done, failed: queue.length - done };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, orgSlug],
  );

  return { items, add, remove, reset, upload, busy };
}
