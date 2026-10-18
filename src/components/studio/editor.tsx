"use client";

import type * as FabricNS from "fabric";
import {
  AlignCenter,
  AlignHorizontalJustifyCenter,
  AlignLeft,
  AlignRight,
  AlignVerticalJustifyCenter,
  ArrowDownToLine,
  ArrowLeft,
  ArrowUpToLine,
  Bold,
  ChevronDown,
  ChevronUp,
  Circle as CircleIcon,
  Copy,
  Download,
  Eye,
  EyeOff,
  ImagePlus,
  Italic,
  Layers,
  Lock,
  Maximize,
  Minus,
  Palette,
  Plus,
  Redo2,
  Send,
  SlidersHorizontal,
  Square,
  Trash2,
  Triangle as TriangleIcon,
  Underline,
  Undo2,
  Unlock,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { fieldBase } from "@/components/ui/input";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Tooltip } from "@/components/ui/tooltip";
import { useWorkspace } from "@/components/shell/workspace-context";
import { cn } from "@/lib/utils";
import { linkDesignOutputAction, saveDesignAction, updateDesignMetaAction } from "@/server/actions/designs";

type Fabric = typeof FabricNS;
type FObj = FabricNS.FabricObject & { uid?: string; name?: string };

const SERIALIZE_PROPS = [
  "uid",
  "name",
  "selectable",
  "evented",
  "lockMovementX",
  "lockMovementY",
  "lockScalingX",
  "lockScalingY",
  "lockRotation",
  "visible",
];
const BASE_FONTS = [
  "Inter",
  "Montserrat",
  "Poppins",
  "DM Sans",
  "Roboto",
  "Lato",
  "Raleway",
  "Oswald",
  "Bebas Neue",
  "Playfair Display",
  "Merriweather",
  "Arial",
  "Georgia",
];
const SYSTEM_FONTS = new Set(["Arial", "Georgia", "Helvetica", "Times New Roman", "Verdana"]);
const SWATCHES = ["#121110", "#ffffff", "#F4BF2F", "#e5562a", "#2563eb", "#16a34a", "#9333ea", "#f1f0ec"];

export type EditorDesign = {
  id: string;
  name: string;
  width: number;
  height: number;
  document: Record<string, unknown>;
  revision: number;
  isTemplate: boolean;
  clientId: string | null;
  projectId: string | null;
  taskId: string | null;
  outputFileId: string | null;
  clientName: string | null;
};

type Brand = { colors: { name: string; hex: string }[]; fonts: { name: string }[] } | null;
type SaveState = "saved" | "dirty" | "saving" | "error" | "conflict";

const uid = () => Math.random().toString(36).slice(2, 10);

const loadedFonts = new Set<string>();
async function ensureFont(family: string) {
  if (!family || SYSTEM_FONTS.has(family) || loadedFonts.has(family)) return;
  loadedFonts.add(family);
  const id = `gf-${family.replace(/\s+/g, "-")}`;
  if (!document.getElementById(id)) {
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:ital,wght@0,400;0,700;1,400&display=swap`;
    document.head.appendChild(link);
  }
  try {
    await Promise.all([document.fonts.load(`400 32px "${family}"`), document.fonts.load(`700 32px "${family}"`)]);
  } catch {
    /* fonte indisponível: o navegador usa a alternativa */
  }
}

async function fileToDataUrl(file: File, maxSide = 2048): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = url;
    });
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL(file.type === "image/png" || file.type === "image/webp" ? "image/png" : "image/jpeg", 0.9);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [head, b64] = dataUrl.split(",");
  const mime = /data:([^;]+)/.exec(head!)?.[1] ?? "image/png";
  const bin = atob(b64!);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export function DesignEditor({ design, brand, canWrite }: { design: EditorDesign; brand: Brand; canWrite: boolean }) {
  const ws = useWorkspace();
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasElRef = useRef<HTMLCanvasElement>(null);
  const fabricRef = useRef<Fabric | null>(null);
  const canvasRef = useRef<FabricNS.Canvas | null>(null);
  const revisionRef = useRef(design.revision);
  const historyRef = useRef<{ stack: string[]; index: number; muted: boolean }>({ stack: [], index: -1, muted: false });
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const historyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const outputFileIdRef = useRef<string | null>(design.outputFileId);

  const [ready, setReady] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [selected, setSelected] = useState<FObj | null>(null);
  const [, force] = useState(0);
  const rerender = useCallback(() => force((n) => n + 1), []);
  const [layers, setLayers] = useState<FObj[]>([]);
  const [panel, setPanel] = useState<"add" | "brand" | "layers">("add");
  const [mobileSheet, setMobileSheet] = useState<null | "add" | "brand" | "layers" | "props">(null);
  const [name, setName] = useState(design.name);
  const [exporting, setExporting] = useState(false);
  const [historyInfo, setHistoryInfo] = useState({ canUndo: false, canRedo: false });

  const fonts = useMemo(() => {
    const brandFonts = brand?.fonts.map((f) => f.name).filter(Boolean) ?? [];
    return [...new Set([...brandFonts, ...BASE_FONTS])];
  }, [brand]);

  /* ---------------------------- utilidades ---------------------------- */

  const snapshot = useCallback(() => {
    const canvas = canvasRef.current!;
    return JSON.stringify(canvas.toObject(SERIALIZE_PROPS));
  }, []);

  const refreshLayers = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setLayers([...(canvas.getObjects() as FObj[])].reverse());
  }, []);

  const updateHistoryInfo = useCallback(() => {
    const h = historyRef.current;
    setHistoryInfo({ canUndo: h.index > 0, canRedo: h.index < h.stack.length - 1 });
  }, []);

  const pushHistory = useCallback(() => {
    const h = historyRef.current;
    if (h.muted || !canvasRef.current) return;
    const snap = snapshot();
    if (h.stack[h.index] === snap) return;
    h.stack = h.stack.slice(0, h.index + 1);
    h.stack.push(snap);
    if (h.stack.length > 60) h.stack.shift();
    h.index = h.stack.length - 1;
    updateHistoryInfo();
  }, [snapshot, updateHistoryInfo]);

  const save = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas || !canWrite) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaveState("saving");
    const z = canvas.getZoom();
    const thumbnail = canvas.toDataURL({
      format: "jpeg",
      quality: 0.72,
      multiplier: 360 / (Math.max(design.width, design.height) * z),
    });
    const res = await saveDesignAction(ws.orgSlug, {
      id: design.id,
      revision: revisionRef.current,
      document: canvas.toObject(SERIALIZE_PROPS),
      thumbnail,
    }).catch(() => ({ ok: false as const, error: "Falha de conexão ao salvar.", code: "internal" }));
    if (res.ok) {
      revisionRef.current = res.data.revision;
      setSaveState((st) => (st === "saving" ? "saved" : st));
    } else if (res.code === "conflict") {
      setSaveState("conflict");
      toast.error(res.error, { duration: 10000 });
    } else {
      setSaveState("error");
      toast.error(res.error);
    }
  }, [canWrite, design.height, design.id, design.width, ws.orgSlug]);

  const markDirty = useCallback(() => {
    if (historyRef.current.muted) return;
    refreshLayers();
    rerender();
    if (historyTimer.current) clearTimeout(historyTimer.current);
    historyTimer.current = setTimeout(pushHistory, 250);
    if (!canWrite) return;
    setSaveState((st) => (st === "conflict" ? st : "dirty"));
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void save(), 1500);
  }, [canWrite, pushHistory, refreshLayers, rerender, save]);

  const fit = useCallback(() => {
    const canvas = canvasRef.current;
    const box = containerRef.current;
    if (!canvas || !box) return;
    const pad = 48;
    const z = Math.max(
      0.05,
      Math.min((box.clientWidth - pad) / design.width, (box.clientHeight - pad) / design.height, 2),
    );
    canvas.setZoom(z);
    canvas.setDimensions({ width: Math.round(design.width * z), height: Math.round(design.height * z) });
    setZoom(z);
  }, [design.height, design.width]);

  const applyZoom = useCallback(
    (z: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const next = Math.max(0.05, Math.min(z, 4));
      canvas.setZoom(next);
      canvas.setDimensions({ width: Math.round(design.width * next), height: Math.round(design.height * next) });
      setZoom(next);
    },
    [design.height, design.width],
  );

  /* ---------------------------- inicialização ---------------------------- */

  useEffect(() => {
    let disposed = false;
    let canvas: FabricNS.Canvas | null = null;
    (async () => {
      const fabric = await import("fabric");
      if (disposed || !canvasElRef.current) return;
      fabricRef.current = fabric;
      canvas = new fabric.Canvas(canvasElRef.current, {
        preserveObjectStacking: true,
        backgroundColor: "#ffffff",
        selectionColor: "rgba(244,191,47,0.12)",
        selectionBorderColor: "#d9a21a",
      });
      fabric.FabricObject.ownDefaults.borderColor = "#d9a21a";
      fabric.FabricObject.ownDefaults.cornerColor = "#ffffff";
      fabric.FabricObject.ownDefaults.cornerStrokeColor = "#d9a21a";
      fabric.FabricObject.ownDefaults.cornerStyle = "circle";
      fabric.FabricObject.ownDefaults.transparentCorners = false;
      canvasRef.current = canvas;

      const doc = design.document as { objects?: { fontFamily?: string }[] };
      await Promise.all((doc.objects ?? []).map((o) => (o.fontFamily ? ensureFont(o.fontFamily) : null)));
      historyRef.current.muted = true;
      await canvas.loadFromJSON(design.document);
      historyRef.current.muted = false;
      if (!canWrite) {
        canvas.selection = false;
        canvas.forEachObject((o) => {
          o.selectable = false;
          o.evented = false;
        });
      }
      fit();
      canvas.requestRenderAll();

      const onSelect = () => setSelected((canvas!.getActiveObject() as FObj) ?? null);
      canvas.on("selection:created", onSelect);
      canvas.on("selection:updated", onSelect);
      canvas.on("selection:cleared", () => setSelected(null));
      canvas.on("object:added", markDirty);
      canvas.on("object:removed", markDirty);
      canvas.on("object:modified", markDirty);
      canvas.on("text:changed", markDirty);

      pushHistory();
      refreshLayers();
      setReady(true);
    })();
    return () => {
      disposed = true;
      canvas?.dispose();
      canvasRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onResize = () => fit();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [fit]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (saveState === "dirty" || saveState === "saving") e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [saveState]);

  /* ---------------------------- ações ---------------------------- */

  const add = useCallback((obj: FObj) => {
    const canvas = canvasRef.current!;
    obj.uid = uid();
    canvas.add(obj);
    canvas.centerObject(obj);
    canvas.setActiveObject(obj);
    canvas.requestRenderAll();
    setMobileSheet(null);
  }, []);

  const addText = (kind: "title" | "subtitle" | "body") => {
    const fabric = fabricRef.current!;
    const size = { title: 0.085, subtitle: 0.05, body: 0.032 }[kind] * design.width;
    const font = brand?.fonts[0]?.name || "Inter";
    void ensureFont(font).then(() => {
      const t = new fabric.Textbox(
        kind === "title"
          ? "Seu título aqui"
          : kind === "subtitle"
            ? "Subtítulo"
            : "Texto de apoio com a mensagem da peça.",
        {
          width: design.width * (kind === "body" ? 0.6 : 0.75),
          fontSize: Math.round(size),
          fontFamily: font,
          fontWeight: kind === "title" ? 700 : 400,
          fill: brand?.colors[0]?.hex ?? "#121110",
          textAlign: "center",
          lineHeight: 1.15,
        },
      ) as FObj;
      t.name = kind === "title" ? "Título" : kind === "subtitle" ? "Subtítulo" : "Texto";
      add(t);
    });
  };

  const addShape = (kind: "rect" | "rounded" | "circle" | "triangle" | "line") => {
    const fabric = fabricRef.current!;
    const s = Math.min(design.width, design.height) * 0.3;
    const fill = brand?.colors[1]?.hex ?? "#F4BF2F";
    let obj: FObj;
    if (kind === "circle") obj = new fabric.Circle({ radius: s / 2, fill }) as FObj;
    else if (kind === "triangle") obj = new fabric.Triangle({ width: s, height: s, fill }) as FObj;
    else if (kind === "line")
      obj = new fabric.Line([0, 0, s * 1.5, 0], {
        stroke: brand?.colors[0]?.hex ?? "#121110",
        strokeWidth: Math.max(4, s / 30),
      }) as FObj;
    else
      obj = new fabric.Rect({
        width: s * 1.4,
        height: s,
        fill,
        rx: kind === "rounded" ? s / 8 : 0,
        ry: kind === "rounded" ? s / 8 : 0,
      }) as FObj;
    obj.name = {
      rect: "Retângulo",
      rounded: "Retângulo arredondado",
      circle: "Círculo",
      triangle: "Triângulo",
      line: "Linha",
    }[kind];
    add(obj);
  };

  const addImage = async (file: File) => {
    if (!file.type.startsWith("image/")) return toast.error("Escolha um arquivo de imagem.");
    if (file.size > 25 * 1024 * 1024) return toast.error("Imagem muito grande (máx. 25 MB).");
    const fabric = fabricRef.current!;
    const dataUrl = await fileToDataUrl(file);
    const img = (await fabric.FabricImage.fromURL(dataUrl)) as FObj;
    const scale = Math.min((design.width * 0.6) / (img.width ?? 1), (design.height * 0.6) / (img.height ?? 1), 1);
    img.scale(scale);
    img.name = file.name.slice(0, 40);
    add(img);
  };

  const withActive = (fn: (o: FObj, canvas: FabricNS.Canvas) => void) => {
    const canvas = canvasRef.current;
    const o = canvas?.getActiveObject() as FObj | undefined;
    if (!canvas || !o) return;
    fn(o, canvas);
    o.setCoords();
    canvas.requestRenderAll();
    markDirty();
  };

  const setProp = (key: string, value: unknown) =>
    withActive((o) => {
      o.set(key as keyof FObj, value as never);
    });

  const setFont = async (family: string) => {
    await ensureFont(family);
    setProp("fontFamily", family);
  };

  const remove = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const objs = canvas.getActiveObjects();
    objs.forEach((o) => canvas.remove(o));
    canvas.discardActiveObject();
    canvas.requestRenderAll();
  };

  const duplicate = async () => {
    const canvas = canvasRef.current;
    const o = canvas?.getActiveObject() as FObj | undefined;
    if (!canvas || !o) return;
    const clone = (await o.clone(SERIALIZE_PROPS)) as FObj;
    clone.set({ left: (o.left ?? 0) + 24, top: (o.top ?? 0) + 24 });
    clone.uid = uid();
    canvas.add(clone);
    canvas.setActiveObject(clone);
    canvas.requestRenderAll();
  };

  const toggleLock = (o: FObj) => {
    const locked = !!o.lockMovementX;
    o.set({
      lockMovementX: !locked,
      lockMovementY: !locked,
      lockScalingX: !locked,
      lockScalingY: !locked,
      lockRotation: !locked,
      hasControls: locked,
    });
    canvasRef.current?.requestRenderAll();
    markDirty();
  };

  const toggleVisible = (o: FObj) => {
    o.set({ visible: !o.visible });
    if (!o.visible) canvasRef.current?.discardActiveObject();
    canvasRef.current?.requestRenderAll();
    markDirty();
  };

  const order = (dir: "up" | "down" | "top" | "bottom") =>
    withActive((o, canvas) => {
      if (dir === "up") canvas.bringObjectForward(o);
      else if (dir === "down") canvas.sendObjectBackwards(o);
      else if (dir === "top") canvas.bringObjectToFront(o);
      else canvas.sendObjectToBack(o);
    });

  const center = (axis: "h" | "v") =>
    withActive((o, canvas) => {
      if (axis === "h") canvas.centerObjectH(o);
      else canvas.centerObjectV(o);
    });

  const restore = async (snap: string) => {
    const canvas = canvasRef.current!;
    historyRef.current.muted = true;
    await canvas.loadFromJSON(JSON.parse(snap));
    historyRef.current.muted = false;
    canvas.requestRenderAll();
    setSelected(null);
    refreshLayers();
    updateHistoryInfo();
    if (canWrite) {
      setSaveState("dirty");
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => void save(), 1200);
    }
  };

  const undo = () => {
    const h = historyRef.current;
    if (h.index <= 0) return;
    h.index--;
    void restore(h.stack[h.index]!);
  };
  const redo = () => {
    const h = historyRef.current;
    if (h.index >= h.stack.length - 1) return;
    h.index++;
    void restore(h.stack[h.index]!);
  };

  const setBackground = (color: string) => {
    const canvas = canvasRef.current!;
    canvas.backgroundColor = color;
    canvas.requestRenderAll();
    markDirty();
  };

  const renderFull = (format: "png" | "jpeg") => {
    const canvas = canvasRef.current!;
    canvas.discardActiveObject();
    canvas.requestRenderAll();
    return canvas.toDataURL({ format, quality: 0.95, multiplier: 1 / canvas.getZoom() });
  };

  const download = (format: "png" | "jpeg") => {
    const url = renderFull(format);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name.replace(/[^\p{L}\p{N}\- ]/gu, "").trim() || "arte"}.${format === "png" ? "png" : "jpg"}`;
    a.click();
  };

  const exportToFiles = async () => {
    setExporting(true);
    try {
      if (saveState !== "saved") await save();
      const blob = dataUrlToBlob(renderFull("png"));
      const form = new FormData();
      form.set("orgSlug", ws.orgSlug);
      form.set("file", new File([blob], `${name || "arte"}.png`, { type: "image/png" }));
      form.set("category", "deliverable");
      form.set("source", "editor");
      const isNewVersion = !!outputFileIdRef.current;
      if (outputFileIdRef.current) form.set("fileId", outputFileIdRef.current);
      if (design.clientId) form.set("clientId", design.clientId);
      if (design.projectId) form.set("projectId", design.projectId);
      if (design.taskId) form.set("taskId", design.taskId);
      form.set("note", "Exportado do Estúdio");
      const res = await fetch("/api/uploads", { method: "POST", body: form });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        results?: { ok: boolean; fileId?: string; versionId?: string; error?: string }[];
      };
      const first = data.results?.[0];
      if (!res.ok || !first?.ok || !first.fileId) {
        throw new Error(first?.error ?? data.error ?? "Não foi possível enviar para Arquivos.");
      }
      const fileId = first.fileId;
      const linked = await linkDesignOutputAction(ws.orgSlug, {
        designId: design.id,
        fileId,
        versionId: first.versionId ?? null,
      });
      if (!linked.ok) throw new Error(linked.error);
      outputFileIdRef.current = fileId;
      toast.success(isNewVersion ? "Nova versão enviada para Arquivos" : "Arte enviada para Arquivos", {
        action: { label: "Abrir", onClick: () => window.open(`/w/${ws.orgSlug}/files/${fileId}`, "_self") },
      });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setExporting(false);
    }
  };

  const rename = async () => {
    if (!canWrite || !name.trim() || name === design.name) return;
    const res = await updateDesignMetaAction(ws.orgSlug, {
      id: design.id,
      name: name.trim(),
      clientId: design.clientId,
      projectId: design.projectId,
      taskId: design.taskId,
    });
    if (!res.ok) toast.error(res.error);
  };

  /* ---------------------------- teclado ---------------------------- */

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable) return;
      const canvas = canvasRef.current;
      const active = canvas?.getActiveObject() as (FObj & { isEditing?: boolean }) | undefined;
      if (active?.isEditing) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save();
      } else if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((mod && e.key.toLowerCase() === "y") || (mod && e.shiftKey && e.key.toLowerCase() === "z")) {
        e.preventDefault();
        redo();
      } else if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        void duplicate();
      } else if ((e.key === "Delete" || e.key === "Backspace") && active && canWrite) {
        e.preventDefault();
        remove();
      } else if (active && e.key.startsWith("Arrow") && canWrite) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        active.set({ left: (active.left ?? 0) + dx, top: (active.top ?? 0) + dy });
        active.setCoords();
        canvas!.requestRenderAll();
        markDirty();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  /* ---------------------------- interface ---------------------------- */

  const isText = selected && (selected.type === "textbox" || selected.type === "i-text" || selected.type === "text");
  const saveLabel = {
    saved: "Salvo",
    dirty: "Alterações não salvas",
    saving: "Salvando…",
    error: "Erro ao salvar",
    conflict: "Conflito: recarregue",
  }[saveState];

  const AddPanel = (
    <div className="grid gap-5">
      <section>
        <h3 className="mb-2 text-xs font-semibold text-fg-subtle uppercase">Texto</h3>
        <div className="grid gap-1.5">
          <button
            type="button"
            onClick={() => addText("title")}
            className="rounded-md border border-border px-3 py-2 text-left text-lg font-bold hover:bg-surface-2"
          >
            Adicionar título
          </button>
          <button
            type="button"
            onClick={() => addText("subtitle")}
            className="rounded-md border border-border px-3 py-2 text-left text-base hover:bg-surface-2"
          >
            Adicionar subtítulo
          </button>
          <button
            type="button"
            onClick={() => addText("body")}
            className="rounded-md border border-border px-3 py-2 text-left text-sm hover:bg-surface-2"
          >
            Adicionar texto
          </button>
        </div>
      </section>
      <section>
        <h3 className="mb-2 text-xs font-semibold text-fg-subtle uppercase">Formas</h3>
        <div className="grid grid-cols-5 gap-1.5">
          {(
            [
              ["rect", Square, "Retângulo"],
              ["rounded", Square, "Arredondado"],
              ["circle", CircleIcon, "Círculo"],
              ["triangle", TriangleIcon, "Triângulo"],
              ["line", Minus, "Linha"],
            ] as const
          ).map(([k, Icon, label]) => (
            <Tooltip key={k} content={label}>
              <button
                type="button"
                onClick={() => addShape(k)}
                aria-label={label}
                className="flex aspect-square items-center justify-center rounded-md border border-border hover:bg-surface-2"
              >
                <Icon className={cn("size-5", k === "rounded" && "rounded-sm")} />
              </button>
            </Tooltip>
          ))}
        </div>
      </section>
      <section>
        <h3 className="mb-2 text-xs font-semibold text-fg-subtle uppercase">Imagem</h3>
        <Button variant="secondary" className="w-full" onClick={() => fileInputRef.current?.click()}>
          <ImagePlus /> Enviar imagem
        </Button>
        <p className="mt-1.5 text-[11px] text-fg-subtle">Imagens grandes são reduzidas para até 2048 px.</p>
      </section>
    </div>
  );

  const BrandPanel = (
    <div className="grid gap-5">
      {!design.clientId ? (
        <p className="text-sm text-fg-muted">Vincule a arte a um cliente para usar as cores e fontes da marca.</p>
      ) : !brand || (!brand.colors.length && !brand.fonts.length) ? (
        <p className="text-sm text-fg-muted">
          Nenhuma cor ou fonte cadastrada para {design.clientName}.{" "}
          <Link href={`/w/${ws.orgSlug}/clients/${design.clientId}/brand`} className="text-accent-text hover:underline">
            Cadastrar marca
          </Link>
        </p>
      ) : (
        <>
          {brand.colors.length ? (
            <section>
              <h3 className="mb-2 text-xs font-semibold text-fg-subtle uppercase">Cores de {design.clientName}</h3>
              <div className="grid grid-cols-5 gap-2">
                {brand.colors.map((c) => (
                  <Tooltip key={c.hex + c.name} content={`${c.name || "Cor"} ${c.hex} — clique para aplicar`}>
                    <button
                      type="button"
                      onClick={() =>
                        selected ? setProp(selected.type === "line" ? "stroke" : "fill", c.hex) : setBackground(c.hex)
                      }
                      className="aspect-square rounded-md border border-border shadow-xs"
                      style={{ background: c.hex }}
                      aria-label={`Aplicar ${c.name || c.hex}`}
                    />
                  </Tooltip>
                ))}
              </div>
              <p className="mt-1.5 text-[11px] text-fg-subtle">
                Com um elemento selecionado, aplica a cor nele; sem seleção, no fundo.
              </p>
            </section>
          ) : null}
          {brand.fonts.length ? (
            <section>
              <h3 className="mb-2 text-xs font-semibold text-fg-subtle uppercase">Fontes</h3>
              <ul className="grid gap-1">
                {brand.fonts.map((f) => (
                  <li key={f.name}>
                    <button
                      type="button"
                      onClick={() => (isText ? void setFont(f.name) : addText("title"))}
                      className="w-full rounded-md border border-border px-3 py-2 text-left text-sm hover:bg-surface-2"
                    >
                      {f.name}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </div>
  );

  const LayersPanel = (
    <ul className="grid gap-1">
      {layers.length === 0 ? <li className="text-sm text-fg-muted">A arte está vazia.</li> : null}
      {layers.map((o, i) => (
        <li
          key={o.uid ?? i}
          className={cn(
            "flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm",
            selected === o ? "border-accent bg-accent-soft/50" : "border-transparent hover:bg-surface-2",
          )}
        >
          <button
            type="button"
            className="min-w-0 flex-1 truncate text-left"
            onClick={() => {
              if (!o.visible) return;
              canvasRef.current?.setActiveObject(o);
              canvasRef.current?.requestRenderAll();
              setSelected(o);
            }}
          >
            {o.name || (o.type === "textbox" ? (o as unknown as { text: string }).text.slice(0, 24) : o.type)}
          </button>
          {canWrite ? (
            <>
              <button
                type="button"
                onClick={() => toggleVisible(o)}
                aria-label={o.visible ? "Ocultar" : "Mostrar"}
                className="text-fg-subtle hover:text-fg"
              >
                {o.visible ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
              </button>
              <button
                type="button"
                onClick={() => toggleLock(o)}
                aria-label={o.lockMovementX ? "Desbloquear" : "Bloquear"}
                className="text-fg-subtle hover:text-fg"
              >
                {o.lockMovementX ? <Lock className="size-3.5" /> : <Unlock className="size-3.5" />}
              </button>
            </>
          ) : null}
        </li>
      ))}
    </ul>
  );

  const numberInput = (
    label: string,
    value: number,
    onChange: (v: number) => void,
    opts: { min?: number; max?: number; step?: number } = {},
  ) => (
    <label className="grid gap-1 text-[11px] text-fg-subtle">
      {label}
      <input
        type="number"
        value={Number.isFinite(value) ? Math.round(value * 100) / 100 : 0}
        min={opts.min}
        max={opts.max}
        step={opts.step ?? 1}
        onChange={(e) => onChange(Number(e.target.value))}
        className={cn(fieldBase, "h-8 px-2 text-sm")}
      />
    </label>
  );

  const colorInput = (label: string, value: string, onChange: (v: string) => void) => (
    <label className="grid gap-1 text-[11px] text-fg-subtle">
      {label}
      <span className="flex items-center gap-2">
        <input
          type="color"
          value={/^#[0-9a-f]{6}$/i.test(value) ? value : "#000000"}
          onChange={(e) => onChange(e.target.value)}
          className="size-8 cursor-pointer rounded-md border border-border bg-surface p-0.5"
        />
        <span className="flex flex-wrap gap-1">
          {SWATCHES.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => onChange(c)}
              className="size-5 rounded border border-border"
              style={{ background: c }}
              aria-label={c}
            />
          ))}
        </span>
      </span>
    </label>
  );

  const PropsPanel = selected ? (
    <div className="grid gap-4">
      <div className="flex flex-wrap gap-1">
        <Tooltip content="Duplicar (Ctrl+D)">
          <Button variant="secondary" size="icon-sm" onClick={() => void duplicate()} aria-label="Duplicar">
            <Copy />
          </Button>
        </Tooltip>
        <Tooltip content="Trazer para frente">
          <Button variant="secondary" size="icon-sm" onClick={() => order("up")} aria-label="Trazer para frente">
            <ChevronUp />
          </Button>
        </Tooltip>
        <Tooltip content="Enviar para trás">
          <Button variant="secondary" size="icon-sm" onClick={() => order("down")} aria-label="Enviar para trás">
            <ChevronDown />
          </Button>
        </Tooltip>
        <Tooltip content="Para o topo">
          <Button variant="secondary" size="icon-sm" onClick={() => order("top")} aria-label="Para o topo">
            <ArrowUpToLine />
          </Button>
        </Tooltip>
        <Tooltip content="Para o fundo">
          <Button variant="secondary" size="icon-sm" onClick={() => order("bottom")} aria-label="Para o fundo">
            <ArrowDownToLine />
          </Button>
        </Tooltip>
        <Tooltip content="Centralizar na horizontal">
          <Button variant="secondary" size="icon-sm" onClick={() => center("h")} aria-label="Centralizar na horizontal">
            <AlignHorizontalJustifyCenter />
          </Button>
        </Tooltip>
        <Tooltip content="Centralizar na vertical">
          <Button variant="secondary" size="icon-sm" onClick={() => center("v")} aria-label="Centralizar na vertical">
            <AlignVerticalJustifyCenter />
          </Button>
        </Tooltip>
        <Tooltip content="Excluir (Delete)">
          <Button variant="danger-ghost" size="icon-sm" onClick={remove} aria-label="Excluir">
            <Trash2 />
          </Button>
        </Tooltip>
      </div>

      {isText ? (
        <section className="grid gap-3">
          <label className="grid gap-1 text-[11px] text-fg-subtle">
            Fonte
            <select
              value={String(selected.get("fontFamily") ?? "Inter")}
              onChange={(e) => void setFont(e.target.value)}
              className={cn(fieldBase, "h-8 px-2 text-sm")}
            >
              {fonts.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            {numberInput("Tamanho", Number(selected.get("fontSize")), (v) => setProp("fontSize", Math.max(4, v)), {
              min: 4,
              max: 1000,
            })}
            {numberInput("Entrelinha", Number(selected.get("lineHeight")), (v) => setProp("lineHeight", v), {
              min: 0.5,
              max: 3,
              step: 0.05,
            })}
          </div>
          <div className="flex flex-wrap gap-1">
            <Button
              variant={
                Number(selected.get("fontWeight")) >= 600 || selected.get("fontWeight") === "bold"
                  ? "primary"
                  : "secondary"
              }
              size="icon-sm"
              aria-label="Negrito"
              onClick={() =>
                setProp(
                  "fontWeight",
                  Number(selected.get("fontWeight")) >= 600 || selected.get("fontWeight") === "bold" ? 400 : 700,
                )
              }
            >
              <Bold />
            </Button>
            <Button
              variant={selected.get("fontStyle") === "italic" ? "primary" : "secondary"}
              size="icon-sm"
              aria-label="Itálico"
              onClick={() => setProp("fontStyle", selected.get("fontStyle") === "italic" ? "normal" : "italic")}
            >
              <Italic />
            </Button>
            <Button
              variant={selected.get("underline") ? "primary" : "secondary"}
              size="icon-sm"
              aria-label="Sublinhado"
              onClick={() => setProp("underline", !selected.get("underline"))}
            >
              <Underline />
            </Button>
            <span className="mx-1 w-px bg-border" />
            {(["left", "center", "right"] as const).map((a) => (
              <Button
                key={a}
                variant={selected.get("textAlign") === a ? "primary" : "secondary"}
                size="icon-sm"
                aria-label={`Alinhar ${a}`}
                onClick={() => setProp("textAlign", a)}
              >
                {a === "left" ? <AlignLeft /> : a === "center" ? <AlignCenter /> : <AlignRight />}
              </Button>
            ))}
          </div>
          {numberInput(
            "Espaçamento entre letras",
            Number(selected.get("charSpacing") ?? 0),
            (v) => setProp("charSpacing", v),
            { min: -200, max: 2000, step: 10 },
          )}
        </section>
      ) : null}

      {selected.type !== "image"
        ? selected.type === "line"
          ? colorInput("Cor da linha", String(selected.get("stroke") ?? "#000000"), (v) => setProp("stroke", v))
          : colorInput(isText ? "Cor do texto" : "Preenchimento", String(selected.get("fill") ?? "#000000"), (v) =>
              setProp("fill", v),
            )
        : null}
      {selected.type === "rect"
        ? numberInput(
            "Arredondamento",
            Number(selected.get("rx") ?? 0),
            (v) => withActive((o) => o.set({ rx: v, ry: v } as never)),
            { min: 0, max: 2000 },
          )
        : null}
      {selected.type !== "line" && !isText && selected.type !== "image" ? (
        <div className="grid grid-cols-2 gap-2">
          {colorInput("Contorno", String(selected.get("stroke") ?? "#000000"), (v) => setProp("stroke", v))}
          {numberInput(
            "Espessura",
            Number(selected.get("strokeWidth") ?? 0),
            (v) => setProp("strokeWidth", Math.max(0, v)),
            { min: 0, max: 200 },
          )}
        </div>
      ) : null}
      <label className="grid gap-1 text-[11px] text-fg-subtle">
        Opacidade: {Math.round(Number(selected.get("opacity") ?? 1) * 100)}%
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={Number(selected.get("opacity") ?? 1)}
          onChange={(e) => setProp("opacity", Number(e.target.value))}
          className="accent-[var(--accent)]"
        />
      </label>
      <div className="grid grid-cols-3 gap-2">
        {numberInput("X", Number(selected.left), (v) => setProp("left", v))}
        {numberInput("Y", Number(selected.top), (v) => setProp("top", v))}
        {numberInput("Rotação", Number(selected.angle), (v) => setProp("angle", v), { min: -360, max: 360 })}
      </div>
    </div>
  ) : (
    <div className="grid gap-4">
      <p className="text-sm text-fg-muted">Selecione um elemento para editar. Sem seleção, ajuste o fundo da arte.</p>
      {canvasRef.current
        ? colorInput("Fundo", String(canvasRef.current.backgroundColor ?? "#ffffff"), setBackground)
        : null}
      <p className="text-xs text-fg-subtle">
        Tamanho final: {design.width}×{design.height}px
      </p>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[var(--z-overlay)] flex flex-col bg-bg">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void addImage(f);
          e.target.value = "";
        }}
      />
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-surface px-2 sm:px-3">
        <Button variant="ghost" size="icon-sm" asChild aria-label="Voltar ao Estúdio">
          <Link href={`/w/${ws.orgSlug}/studio`}>
            <ArrowLeft />
          </Link>
        </Button>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => void rename()}
          readOnly={!canWrite}
          aria-label="Nome da arte"
          className="h-8 w-28 min-w-0 rounded-md border border-transparent bg-transparent px-2 text-sm font-medium hover:border-border focus:border-accent focus:outline-none sm:w-64"
        />
        <span
          className={cn(
            "hidden text-xs sm:inline",
            saveState === "error" || saveState === "conflict"
              ? "text-danger"
              : saveState === "dirty"
                ? "text-warning"
                : "text-fg-subtle",
          )}
          aria-live="polite"
        >
          {canWrite ? saveLabel : "Somente leitura"}
        </span>
        {saveState === "conflict" ? (
          <Button size="xs" variant="secondary" onClick={() => window.location.reload()}>
            Recarregar
          </Button>
        ) : null}
        <span className="flex-1" />
        {canWrite ? (
          <>
            <Tooltip content="Desfazer (Ctrl+Z)">
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={undo}
                disabled={!historyInfo.canUndo}
                aria-label="Desfazer"
              >
                <Undo2 />
              </Button>
            </Tooltip>
            <Tooltip content="Refazer (Ctrl+Y)">
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={redo}
                disabled={!historyInfo.canRedo}
                aria-label="Refazer"
              >
                <Redo2 />
              </Button>
            </Tooltip>
          </>
        ) : null}
        <div className="hidden items-center gap-0.5 md:flex">
          <Button variant="ghost" size="icon-sm" onClick={() => applyZoom(zoom / 1.2)} aria-label="Diminuir zoom">
            <ZoomOut />
          </Button>
          <button
            type="button"
            onClick={fit}
            className="tabular w-12 text-center text-xs text-fg-muted hover:text-fg"
            title="Ajustar à tela"
          >
            {Math.round(zoom * 100)}%
          </button>
          <Button variant="ghost" size="icon-sm" onClick={() => applyZoom(zoom * 1.2)} aria-label="Aumentar zoom">
            <ZoomIn />
          </Button>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => download("png")}
          disabled={!ready}
          className="hidden sm:inline-flex"
        >
          <Download /> PNG
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => download("jpeg")}
          disabled={!ready}
          className="hidden lg:inline-flex"
        >
          <Download /> JPG
        </Button>
        {canWrite && !design.isTemplate ? (
          <Button
            variant="primary"
            size="sm"
            onClick={() => void exportToFiles()}
            loading={exporting}
            disabled={!ready}
          >
            <Send /> <span className="hidden sm:inline">Enviar para Arquivos</span>
            <span className="sm:hidden">Enviar</span>
          </Button>
        ) : null}
      </header>

      <div className="flex min-h-0 flex-1">
        {canWrite ? (
          <aside className="hidden w-72 shrink-0 flex-col border-r border-border bg-surface lg:flex">
            <div className="flex gap-1 border-b border-border p-2">
              {(
                [
                  ["add", "Adicionar", Plus],
                  ["brand", "Marca", Palette],
                  ["layers", "Camadas", Layers],
                ] as const
              ).map(([k, label, Icon]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setPanel(k)}
                  className={cn(
                    "flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-medium",
                    panel === k ? "bg-surface-2 text-fg" : "text-fg-muted hover:text-fg",
                  )}
                >
                  <Icon className="size-3.5" /> {label}
                </button>
              ))}
            </div>
            <div className="min-h-0 flex-1 scrollbar-thin overflow-y-auto p-4">
              {panel === "add" ? AddPanel : panel === "brand" ? BrandPanel : LayersPanel}
            </div>
          </aside>
        ) : null}

        <div
          ref={containerRef}
          className="relative flex min-w-0 flex-1 items-center justify-center overflow-auto bg-[repeating-conic-gradient(var(--surface-2)_0_25%,var(--bg)_0_50%)] bg-[length:20px_20px]"
          onMouseDown={(e) => {
            if (e.target === containerRef.current) {
              canvasRef.current?.discardActiveObject();
              canvasRef.current?.requestRenderAll();
            }
          }}
        >
          <div className="shadow-lg ring-1 ring-black/10">
            <canvas ref={canvasElRef} />
          </div>
          {!ready ? <p className="absolute text-sm text-fg-muted">Carregando editor…</p> : null}
          <Button
            variant="secondary"
            size="icon-sm"
            className="absolute right-3 bottom-3 shadow-md lg:hidden"
            onClick={fit}
            aria-label="Ajustar à tela"
          >
            <Maximize />
          </Button>
        </div>

        {canWrite ? (
          <aside className="hidden w-72 shrink-0 scrollbar-thin overflow-y-auto border-l border-border bg-surface p-4 lg:block">
            <h2 className="mb-3 text-xs font-semibold text-fg-subtle uppercase">
              {selected ? "Propriedades" : "Arte"}
            </h2>
            {PropsPanel}
          </aside>
        ) : null}
      </div>

      {canWrite ? (
        <nav
          className="flex shrink-0 justify-around border-t border-border bg-surface px-2 py-1.5 lg:hidden"
          aria-label="Ferramentas"
        >
          {(
            [
              ["add", "Adicionar", Plus],
              ["brand", "Marca", Palette],
              ["props", "Editar", SlidersHorizontal],
              ["layers", "Camadas", Layers],
            ] as const
          ).map(([k, label, Icon]) => (
            <button
              key={k}
              type="button"
              onClick={() => setMobileSheet(k)}
              className="flex flex-col items-center gap-0.5 rounded-md px-3 py-1 text-[11px] text-fg-muted hover:text-fg"
            >
              <Icon className="size-5" />
              {label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex flex-col items-center gap-0.5 rounded-md px-3 py-1 text-[11px] text-fg-muted"
          >
            <ImagePlus className="size-5" />
            Imagem
          </button>
        </nav>
      ) : null}

      <Sheet open={!!mobileSheet} onOpenChange={(o) => !o && setMobileSheet(null)}>
        <SheetContent side="right" width="sm" aria-describedby={undefined} className="max-w-[340px]">
          <SheetTitle className="border-b border-border px-4 py-3.5 text-sm font-semibold">
            {{ add: "Adicionar", brand: "Marca", layers: "Camadas", props: "Editar" }[mobileSheet ?? "add"]}
          </SheetTitle>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {mobileSheet === "add"
              ? AddPanel
              : mobileSheet === "brand"
                ? BrandPanel
                : mobileSheet === "layers"
                  ? LayersPanel
                  : PropsPanel}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
