"use client";

import { Plus, Save, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { useOrgAction } from "@/hooks/use-action";
import { updateBrandProfileAction } from "@/server/actions/clients";

type Brand = {
  toneOfVoice: string | null;
  audience: string | null;
  objectives: string | null;
  positioning: string | null;
  keywords: string[];
  avoid: string | null;
  guidelines: string | null;
  colors: { name: string; hex: string; usage?: string }[];
  fonts: { name: string; usage?: string; source?: string }[];
};

const EMPTY: Brand = {
  toneOfVoice: "",
  audience: "",
  objectives: "",
  positioning: "",
  keywords: [],
  avoid: "",
  guidelines: "",
  colors: [],
  fonts: [],
};

/** Perfil da marca: contexto usado pela equipe criativa e pelo assistente de IA. */
export function BrandEditor({
  clientId,
  brand,
  canWrite,
}: {
  clientId: string;
  brand: Brand | null;
  canWrite: boolean;
}) {
  const [state, setState] = useState<Brand>(brand ?? EMPTY);
  const [keyword, setKeyword] = useState("");
  const [dirty, setDirty] = useState(false);
  const save = useOrgAction(updateBrandProfileAction, {
    success: "Marca atualizada",
    onSuccess: () => setDirty(false),
  });

  function patch(p: Partial<Brand>) {
    setState((s) => ({ ...s, ...p }));
    setDirty(true);
  }

  const text = (key: keyof Brand, label: string, hint?: string, rows = 3) => (
    <Field label={label} htmlFor={`b-${key}`} hint={hint}>
      <Textarea
        id={`b-${key}`}
        rows={rows}
        value={(state[key] as string | null) ?? ""}
        onChange={(e) => patch({ [key]: e.target.value } as Partial<Brand>)}
        readOnly={!canWrite}
      />
    </Field>
  );

  return (
    <div className="grid gap-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Posicionamento e comunicação</CardTitle>
              <CardDescription>Usado como contexto nas criações e no assistente de IA (se autorizado).</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="grid gap-4">
            {text("toneOfVoice", "Tom de voz", "Ex.: próximo, bem-humorado, sem gírias, trata o público por 'você'.")}
            {text("audience", "Público-alvo")}
            {text("objectives", "Objetivos de comunicação")}
            {text("positioning", "Posicionamento / diferenciais")}
            {text("avoid", "Evitar", "Palavras, temas, abordagens ou concorrentes que não devem aparecer.", 2)}
            <Field label="Palavras-chave" htmlFor="b-kw">
              <div className="flex flex-wrap gap-1.5">
                {state.keywords.map((k) => (
                  <span
                    key={k}
                    className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-xs"
                  >
                    {k}
                    {canWrite ? (
                      <button
                        type="button"
                        aria-label={`Remover ${k}`}
                        onClick={() => patch({ keywords: state.keywords.filter((x) => x !== k) })}
                      >
                        <X className="size-3" />
                      </button>
                    ) : null}
                  </span>
                ))}
              </div>
              {canWrite ? (
                <Input
                  id="b-kw"
                  value={keyword}
                  placeholder="Digite e pressione Enter"
                  onChange={(e) => setKeyword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && keyword.trim()) {
                      e.preventDefault();
                      if (!state.keywords.includes(keyword.trim()))
                        patch({ keywords: [...state.keywords, keyword.trim()] });
                      setKeyword("");
                    }
                  }}
                />
              ) : null}
            </Field>
          </CardContent>
        </Card>

        <div className="grid content-start gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Cores</CardTitle>
              {canWrite ? (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Adicionar cor"
                  onClick={() => patch({ colors: [...state.colors, { name: "", hex: "#000000" }] })}
                >
                  <Plus />
                </Button>
              ) : null}
            </CardHeader>
            <CardContent>
              {state.colors.length === 0 ? <p className="text-sm text-fg-muted">Nenhuma cor cadastrada.</p> : null}
              <ul className="grid gap-2">
                {state.colors.map((c, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <input
                      type="color"
                      value={c.hex}
                      disabled={!canWrite}
                      onChange={(e) =>
                        patch({ colors: state.colors.map((x, j) => (j === i ? { ...x, hex: e.target.value } : x)) })
                      }
                      className="size-9 shrink-0 cursor-pointer rounded-md border border-border bg-surface p-0.5"
                      aria-label="Cor"
                    />
                    <Input
                      value={c.name}
                      placeholder="Nome (ex.: Primária)"
                      readOnly={!canWrite}
                      onChange={(e) =>
                        patch({ colors: state.colors.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })
                      }
                    />
                    <code className="w-20 shrink-0 text-xs text-fg-muted uppercase">{c.hex}</code>
                    {canWrite ? (
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label="Remover cor"
                        onClick={() => patch({ colors: state.colors.filter((_, j) => j !== i) })}
                      >
                        <X />
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Tipografia</CardTitle>
              {canWrite ? (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Adicionar fonte"
                  onClick={() => patch({ fonts: [...state.fonts, { name: "" }] })}
                >
                  <Plus />
                </Button>
              ) : null}
            </CardHeader>
            <CardContent>
              {state.fonts.length === 0 ? <p className="text-sm text-fg-muted">Nenhuma fonte cadastrada.</p> : null}
              <ul className="grid gap-2">
                {state.fonts.map((f, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <Input
                      value={f.name}
                      placeholder="Fonte (ex.: Inter)"
                      readOnly={!canWrite}
                      onChange={(e) =>
                        patch({ fonts: state.fonts.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })
                      }
                    />
                    <Input
                      value={f.usage ?? ""}
                      placeholder="Uso (títulos, textos…)"
                      readOnly={!canWrite}
                      onChange={(e) =>
                        patch({ fonts: state.fonts.map((x, j) => (j === i ? { ...x, usage: e.target.value } : x)) })
                      }
                    />
                    {canWrite ? (
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label="Remover fonte"
                        onClick={() => patch({ fonts: state.fonts.filter((_, j) => j !== i) })}
                      >
                        <X />
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Diretrizes</CardTitle>
            </CardHeader>
            <CardContent>
              {text(
                "guidelines",
                "Regras de uso da marca",
                "Área de proteção, aplicações proibidas, assinatura, hashtags oficiais…",
                6,
              )}
            </CardContent>
          </Card>
        </div>
      </div>
      {canWrite ? (
        <div className="sticky bottom-4 z-[var(--z-sticky)] flex justify-end">
          <Button
            variant="primary"
            size="lg"
            className="shadow-lg"
            disabled={!dirty}
            loading={save.pending}
            onClick={() =>
              save.run({
                clientId,
                ...state,
                colors: state.colors.filter((c) => /^#[0-9a-fA-F]{6}$/.test(c.hex)),
                fonts: state.fonts.filter((f) => f.name.trim()),
              })
            }
          >
            <Save /> Salvar marca
          </Button>
        </div>
      ) : null}
    </div>
  );
}
