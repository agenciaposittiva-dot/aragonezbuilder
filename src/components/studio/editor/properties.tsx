"use client";

import {
  AlignCenter,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignHorizontalJustifyCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  AlignVerticalJustifyCenter,
  ArrowDownToLine,
  ArrowUpToLine,
  Bold,
  ChevronDown,
  ChevronUp,
  Component,
  Copy,
  Eye,
  EyeOff,
  FlipHorizontal2,
  FlipVertical2,
  Group,
  ImageUp,
  Italic,
  Lock,
  Plus,
  Strikethrough,
  Trash2,
  Underline,
  Ungroup,
  Unlink,
  Unlock,
  X,
} from "lucide-react";
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  findPreset,
  FORMAT_PRESETS,
  instanceChildren,
  locate,
  typeLabel,
  type DesignObject,
  type ImageObject,
  type Paint,
  type TextObject,
} from "@/lib/design-doc";
import type { EditorActions, EditorBrand } from "./actions";
import { ColorField, IconToggle, NumberField, PaintField, RangeField, Section, SelectField } from "./fields";
import { ensureFont, BASE_FONTS } from "./fonts";
import { useEditor, type EditorStore } from "./store";

const WEIGHTS = [
  { value: "100", label: "Fino (100)" },
  { value: "200", label: "Extra leve (200)" },
  { value: "300", label: "Leve (300)" },
  { value: "400", label: "Regular (400)" },
  { value: "500", label: "Médio (500)" },
  { value: "600", label: "Seminegrito (600)" },
  { value: "700", label: "Negrito (700)" },
  { value: "800", label: "Extra negrito (800)" },
  { value: "900", label: "Black (900)" },
];

/**
 * Painel de propriedades contextual: o que aparece depende do que está
 * selecionado (texto, forma, imagem, linha, grupo, componente) ou, sem
 * seleção, da página.
 */
export function PropertiesPanel({
  store,
  actions,
  brand,
  onReplaceImage,
}: {
  store: EditorStore;
  actions: EditorActions;
  brand: EditorBrand;
  onReplaceImage: () => void;
}) {
  const selection = useEditor(store, (s) => s.selection);
  const doc = useEditor(store, (s) => s.doc);
  const swatches = brand?.colors.map((c) => c.hex) ?? [];
  const objects = selection.map((id) => locate(doc, id)?.object).filter((o): o is DesignObject => !!o);

  if (!objects.length) return <PageProperties store={store} actions={actions} swatches={swatches} />;
  if (objects.length > 1) return <MultiProperties objects={objects} actions={actions} swatches={swatches} />;
  return (
    <ObjectProperties
      key={objects[0]!.id}
      o={objects[0]!}
      store={store}
      actions={actions}
      brand={brand}
      swatches={swatches}
      onReplaceImage={onReplaceImage}
    />
  );
}

function AlignRow({ actions, multi }: { actions: EditorActions; multi: boolean }) {
  const items = [
    ["left", AlignStartVertical, "Alinhar à esquerda"],
    ["hcenter", AlignHorizontalJustifyCenter, "Centralizar na horizontal"],
    ["right", AlignEndVertical, "Alinhar à direita"],
    ["top", AlignStartHorizontal, "Alinhar ao topo"],
    ["vcenter", AlignVerticalJustifyCenter, "Centralizar na vertical"],
    ["bottom", AlignEndHorizontal, "Alinhar à base"],
  ] as const;
  return (
    <div className="grid gap-1.5">
      <div className="flex flex-wrap gap-1">
        {items.map(([edge, Icon, label]) => (
          <IconToggle key={edge} label={`${label}${multi ? "" : " da página"}`} onClick={() => actions.align(edge)}>
            <Icon />
          </IconToggle>
        ))}
      </div>
      {multi ? (
        <div className="flex gap-1">
          <IconToggle label="Distribuir na horizontal" onClick={() => actions.distribute("horizontal")}>
            <AlignHorizontalDistributeCenter />
          </IconToggle>
          <IconToggle label="Distribuir na vertical" onClick={() => actions.distribute("vertical")}>
            <AlignVerticalDistributeCenter />
          </IconToggle>
        </div>
      ) : null}
    </div>
  );
}

function OrderRow({ actions }: { actions: EditorActions }) {
  return (
    <div className="flex flex-wrap gap-1">
      <IconToggle label="Trazer para frente" onClick={() => actions.reorder("forward")}>
        <ChevronUp />
      </IconToggle>
      <IconToggle label="Enviar para trás" onClick={() => actions.reorder("backward")}>
        <ChevronDown />
      </IconToggle>
      <IconToggle label="Trazer para o topo" onClick={() => actions.reorder("front")}>
        <ArrowUpToLine />
      </IconToggle>
      <IconToggle label="Enviar para o fundo" onClick={() => actions.reorder("back")}>
        <ArrowDownToLine />
      </IconToggle>
    </div>
  );
}

function MultiProperties({
  objects,
  actions,
  swatches,
}: {
  objects: DesignObject[];
  actions: EditorActions;
  swatches: string[];
}) {
  const opacity = objects.every((o) => o.opacity === objects[0]!.opacity) ? objects[0]!.opacity : 1;
  return (
    <div>
      <Section title={`${objects.length} elementos selecionados`}>
        <div className="flex flex-wrap gap-1.5">
          <Button size="xs" variant="secondary" onClick={actions.group}>
            <Group /> Agrupar
          </Button>
          <Button size="xs" variant="secondary" onClick={actions.duplicate}>
            <Copy /> Duplicar
          </Button>
          <Button size="xs" variant="secondary" onClick={actions.createComponent}>
            <Component /> Criar componente
          </Button>
          <Button size="xs" variant="danger-ghost" onClick={actions.remove}>
            <Trash2 /> Excluir
          </Button>
        </div>
      </Section>
      <Section title="Alinhar e distribuir">
        <AlignRow actions={actions} multi />
      </Section>
      <Section title="Camada">
        <OrderRow actions={actions} />
        <RangeField
          label="Opacidade"
          value={opacity}
          min={0}
          max={1}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(v) => actions.setStyle({ opacity: v }, "opacity")}
        />
      </Section>
      <Section title="Cor">
        <ColorField
          label="Aplicar cor a todos"
          value={null}
          swatches={swatches}
          onChange={(c) => c && actions.setStyle({ fill: c })}
        />
      </Section>
    </div>
  );
}

function ObjectProperties({
  o,
  store,
  actions,
  brand,
  swatches,
  onReplaceImage,
}: {
  o: DesignObject;
  store: EditorStore;
  actions: EditorActions;
  brand: EditorBrand;
  swatches: string[];
  onReplaceImage: () => void;
}) {
  const nameRef = useRef<HTMLInputElement>(null);
  const isGroup = o.type === "group";
  const set = (patch: Record<string, unknown>, coalesce?: string) => actions.update(o.id, patch, coalesce);
  const fonts = [...new Set([...(brand?.fonts.map((f) => f.name).filter(Boolean) ?? []), ...BASE_FONTS])];
  return (
    <div>
      <Section
        title={typeLabel(o.type)}
        actions={
          <div className="flex gap-1">
            <IconToggle
              label={o.hidden ? "Mostrar elemento" : "Ocultar elemento"}
              pressed={o.hidden}
              onClick={() => actions.toggleHidden(o.id)}
            >
              {o.hidden ? <EyeOff /> : <Eye />}
            </IconToggle>
            <IconToggle
              label={o.locked ? "Desbloquear elemento" : "Bloquear elemento"}
              pressed={o.locked}
              onClick={() => actions.toggleLocked(o.id)}
            >
              {o.locked ? <Lock /> : <Unlock />}
            </IconToggle>
          </div>
        }
      >
        <input
          ref={nameRef}
          aria-label="Nome da camada"
          defaultValue={o.name}
          onBlur={(e) => actions.rename(o.id, e.currentTarget.value)}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          className="h-8 w-full rounded-md border border-border bg-surface px-2 text-sm"
        />
        {o.locked ? <p className="text-xs text-fg-muted">Bloqueado: desbloqueie para editar no canvas.</p> : null}
        <div className="flex flex-wrap gap-1.5">
          <Button size="xs" variant="secondary" onClick={actions.duplicate} aria-label="Duplicar elemento">
            <Copy /> Duplicar
          </Button>
          {isGroup ? (
            <>
              <Button size="xs" variant="secondary" onClick={actions.ungroup}>
                <Ungroup /> Desagrupar
              </Button>
              <Button size="xs" variant="secondary" onClick={() => store.enterGroup(o.id)}>
                Abrir grupo
              </Button>
            </>
          ) : null}
          {o.type !== "instance" ? (
            <Button size="xs" variant="secondary" onClick={actions.createComponent}>
              <Component /> Componente
            </Button>
          ) : null}
          <Button size="xs" variant="danger-ghost" onClick={actions.remove} aria-label="Excluir elemento">
            <Trash2 /> Excluir
          </Button>
        </div>
      </Section>

      <Section title="Posição e tamanho">
        <div className="grid grid-cols-2 gap-2">
          <NumberField label="X" value={o.x} onCommit={(v) => set({ x: v })} />
          <NumberField label="Y" value={o.y} onCommit={(v) => set({ y: v })} />
          <NumberField
            label={o.type === "line" ? "Comprimento" : "Largura"}
            value={o.width}
            min={1}
            onCommit={(v) => {
              const lockRatio = o.type === "image" || isGroup || o.type === "instance" || o.type === "path";
              set(lockRatio && o.width > 0 ? { width: v, height: (o.height * v) / o.width } : { width: v });
            }}
          />
          {o.type !== "line" && o.type !== "text" ? (
            <NumberField
              label="Altura"
              value={o.height}
              min={1}
              onCommit={(v) => {
                const lockRatio = o.type === "image" || isGroup || o.type === "instance" || o.type === "path";
                set(lockRatio && o.height > 0 ? { height: v, width: (o.width * v) / o.height } : { height: v });
              }}
            />
          ) : o.type === "text" ? (
            <div className="grid gap-1 text-[11px] text-fg-subtle">
              Altura
              <span className="flex h-8 items-center rounded-md border border-dashed border-border px-2 text-xs text-fg-muted">
                {Math.round(o.height)} px · automática
              </span>
            </div>
          ) : null}
          {!isGroup && o.type !== "fabric" ? (
            <NumberField
              label="Rotação"
              value={o.rotation}
              suffix="°"
              min={-360}
              max={360}
              onCommit={(v) => set({ rotation: v })}
            />
          ) : null}
          {o.type === "image" || o.type === "path" || o.type === "instance" ? (
            <div className="flex items-end gap-1">
              <IconToggle label="Espelhar na horizontal" pressed={o.flipX} onClick={() => set({ flipX: !o.flipX })}>
                <FlipHorizontal2 />
              </IconToggle>
              <IconToggle label="Espelhar na vertical" pressed={o.flipY} onClick={() => set({ flipY: !o.flipY })}>
                <FlipVertical2 />
              </IconToggle>
            </div>
          ) : null}
        </div>
      </Section>

      <Section title="Alinhar à página">
        <AlignRow actions={actions} multi={false} />
      </Section>

      {o.type === "text" ? <TextSection o={o} actions={actions} fonts={fonts} swatches={swatches} /> : null}

      {o.type === "rect" ||
      o.type === "ellipse" ||
      o.type === "triangle" ||
      o.type === "polygon" ||
      o.type === "path" ? (
        <Section title="Preenchimento e contorno">
          <PaintField
            label="Preenchimento"
            value={o.fill}
            allowNone
            swatches={swatches}
            onChange={(p, live) => actions.setStyle({ fill: p }, live ? "fill" : undefined)}
          />
          <StrokeFields o={o} actions={actions} swatches={swatches} />
          {o.type === "rect" ? (
            <NumberField
              label="Arredondamento"
              value={o.radius ?? 0}
              min={0}
              onCommit={(v) => actions.setStyle({ radius: v })}
            />
          ) : null}
          {o.type === "polygon" ? (
            <div className="grid grid-cols-2 gap-2">
              <NumberField
                label="Lados / pontas"
                value={o.sides}
                min={3}
                max={24}
                onCommit={(v) => set({ sides: Math.round(v) })}
              />
              <NumberField
                label="Estrela (raio interno %)"
                value={o.innerRatio ? Math.round(o.innerRatio * 100) : 0}
                min={0}
                max={95}
                onCommit={(v) => set({ innerRatio: v >= 5 ? v / 100 : null })}
              />
            </div>
          ) : null}
        </Section>
      ) : null}

      {o.type === "line" ? (
        <Section title="Linha">
          <ColorField
            label="Cor"
            value={o.stroke}
            swatches={swatches}
            onChange={(c, live) => c && actions.setStyle({ stroke: c }, live ? "stroke" : undefined)}
          />
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              label="Espessura"
              value={o.strokeWidth}
              min={0.5}
              onCommit={(v) => actions.setStyle({ strokeWidth: v })}
            />
            <SelectField
              label="Pontas"
              value={o.lineCap ?? "butt"}
              onChange={(v) => actions.setStyle({ lineCap: v as "butt" })}
              options={[
                { value: "butt", label: "Retas" },
                { value: "round", label: "Arredondadas" },
                { value: "square", label: "Quadradas" },
              ]}
            />
          </div>
          <DashField value={o.strokeDash} width={o.strokeWidth} onChange={(d) => actions.setStyle({ strokeDash: d })} />
        </Section>
      ) : null}

      {o.type === "image" ? (
        <ImageSection o={o} actions={actions} swatches={swatches} onReplace={onReplaceImage} />
      ) : null}

      {o.type === "instance" ? <InstanceSection o={o} store={store} actions={actions} /> : null}

      {o.type === "fabric" ? (
        <Section title="Elemento do formato antigo">
          <p className="text-xs text-fg-muted">
            Este elemento veio de uma versão anterior do editor e foi mantido exatamente como era. Você pode movê-lo,
            ocultá-lo, mudar a opacidade ou excluí-lo.
          </p>
        </Section>
      ) : null}

      {isGroup ? (
        <Section title="Cor do grupo">
          <ColorField
            label="Aplicar a todos os elementos"
            value={null}
            swatches={swatches}
            onChange={(c) => c && actions.setStyle({ fill: c })}
          />
        </Section>
      ) : null}

      <Section title="Camada">
        <OrderRow actions={actions} />
        <RangeField
          label="Opacidade"
          value={o.opacity}
          min={0}
          max={1}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(v) => set({ opacity: v }, `opacity:${o.id}`)}
        />
      </Section>

      {!isGroup && o.type !== "fabric" ? (
        <Section
          title="Sombra"
          actions={
            <button
              type="button"
              className="text-[11px] text-accent-text hover:underline"
              onClick={() =>
                o.shadow
                  ? actions.update(o.id, {}, undefined, ["shadow"])
                  : set({ shadow: { color: "rgba(0,0,0,0.35)", blur: 20, offsetX: 0, offsetY: 8 } })
              }
            >
              {o.shadow ? "Remover" : "Adicionar"}
            </button>
          }
        >
          {o.shadow ? (
            <div className="grid gap-2">
              <ColorField
                label="Cor da sombra"
                value={o.shadow.color}
                onChange={(c, live) =>
                  c && set({ shadow: { ...o.shadow!, color: c } }, live ? `shadow:${o.id}` : undefined)
                }
              />
              <div className="grid grid-cols-3 gap-2">
                <NumberField
                  label="Desfoque"
                  value={o.shadow.blur}
                  min={0}
                  onCommit={(v) => set({ shadow: { ...o.shadow!, blur: v } })}
                />
                <NumberField
                  label="X"
                  value={o.shadow.offsetX}
                  onCommit={(v) => set({ shadow: { ...o.shadow!, offsetX: v } })}
                  ariaLabel="Deslocamento X da sombra"
                />
                <NumberField
                  label="Y"
                  value={o.shadow.offsetY}
                  onCommit={(v) => set({ shadow: { ...o.shadow!, offsetY: v } })}
                  ariaLabel="Deslocamento Y da sombra"
                />
              </div>
            </div>
          ) : null}
        </Section>
      ) : null}
    </div>
  );
}

function StrokeFields({
  o,
  actions,
  swatches,
}: {
  o: Extract<DesignObject, { type: "rect" | "ellipse" | "triangle" | "polygon" | "path" }>;
  actions: EditorActions;
  swatches: string[];
}) {
  return (
    <div className="grid gap-2">
      <ColorField
        label="Contorno"
        value={o.stroke ?? null}
        allowNone
        swatches={swatches}
        onChange={(c, live) =>
          actions.setStyle(
            { stroke: c, ...(c && !o.strokeWidth ? { strokeWidth: 4 } : {}) },
            live ? "stroke" : undefined,
          )
        }
      />
      {o.stroke ? (
        <>
          <NumberField
            label="Espessura do contorno"
            value={o.strokeWidth ?? 1}
            min={0}
            onCommit={(v) => actions.setStyle({ strokeWidth: v })}
          />
          <DashField
            value={o.strokeDash ?? null}
            width={o.strokeWidth ?? 1}
            onChange={(d) => actions.setStyle({ strokeDash: d })}
          />
        </>
      ) : null}
    </div>
  );
}

function DashField({
  value,
  width,
  onChange,
}: {
  value: number[] | null | undefined;
  width: number;
  onChange: (d: number[] | null) => void;
}) {
  const kind = !value?.length ? "solid" : value[0]! <= width * 1.2 ? "dotted" : "dashed";
  return (
    <SelectField
      label="Traço"
      value={kind}
      onChange={(v) =>
        onChange(
          v === "solid"
            ? null
            : v === "dotted"
              ? [Math.max(1, width), Math.max(2, width * 1.5)]
              : [Math.max(4, width * 3), Math.max(3, width * 2)],
        )
      }
      options={[
        { value: "solid", label: "Contínuo" },
        { value: "dashed", label: "Tracejado" },
        { value: "dotted", label: "Pontilhado" },
      ]}
    />
  );
}

function TextSection({
  o,
  actions,
  fonts,
  swatches,
}: {
  o: TextObject;
  actions: EditorActions;
  fonts: string[];
  swatches: string[];
}) {
  const style = actions.setStyle;
  const allFonts = fonts.includes(o.fontFamily) ? fonts : [o.fontFamily, ...fonts];
  return (
    <Section title="Texto">
      <SelectField
        label="Fonte"
        value={o.fontFamily}
        onChange={async (f) => {
          await ensureFont(f);
          style({ fontFamily: f });
        }}
        options={allFonts.map((f) => ({ value: f, label: f }))}
      />
      <div className="grid grid-cols-2 gap-2">
        <SelectField
          label="Peso"
          value={String(o.fontWeight)}
          onChange={(v) => style({ fontWeight: Number(v) })}
          options={WEIGHTS}
        />
        <NumberField
          label="Tamanho"
          value={o.fontSize}
          min={1}
          max={5000}
          suffix="px"
          onCommit={(v) => style({ fontSize: v })}
        />
        <NumberField
          label="Entrelinha"
          value={o.lineHeight}
          min={0.3}
          max={10}
          step={0.05}
          onCommit={(v) => style({ lineHeight: v })}
        />
        <NumberField
          label="Espaçamento"
          value={o.letterSpacing / 10}
          min={-100}
          max={1000}
          step={0.5}
          suffix="%"
          ariaLabel="Espaçamento entre letras (%)"
          onCommit={(v) => style({ letterSpacing: Math.round(v * 10) })}
        />
      </div>
      <div className="flex flex-wrap gap-1">
        <IconToggle
          label="Negrito"
          pressed={o.fontWeight >= 600}
          onClick={() => style({ fontWeight: o.fontWeight >= 600 ? 400 : 700 })}
        >
          <Bold />
        </IconToggle>
        <IconToggle
          label="Itálico"
          pressed={o.fontStyle === "italic"}
          onClick={() => style({ fontStyle: o.fontStyle === "italic" ? "normal" : "italic" })}
        >
          <Italic />
        </IconToggle>
        <IconToggle label="Sublinhado" pressed={!!o.underline} onClick={() => style({ underline: !o.underline })}>
          <Underline />
        </IconToggle>
        <IconToggle label="Tachado" pressed={!!o.linethrough} onClick={() => style({ linethrough: !o.linethrough })}>
          <Strikethrough />
        </IconToggle>
        <span className="mx-0.5 w-px bg-border" />
        {(
          [
            ["left", AlignLeft, "Texto à esquerda"],
            ["center", AlignCenter, "Texto centralizado"],
            ["right", AlignRight, "Texto à direita"],
            ["justify", AlignJustify, "Texto justificado"],
          ] as const
        ).map(([a, Icon, label]) => (
          <IconToggle key={a} label={label} pressed={o.textAlign === a} onClick={() => style({ textAlign: a })}>
            <Icon />
          </IconToggle>
        ))}
      </div>
      <PaintField
        label="Cor do texto"
        value={o.color}
        swatches={swatches}
        onChange={(p, live) => p && style({ color: p as Paint }, live ? "color" : undefined)}
      />
      <ColorField
        label="Contorno do texto"
        value={o.stroke ?? null}
        allowNone
        swatches={swatches}
        onChange={(c, live) =>
          style({ stroke: c, ...(c && !o.strokeWidth ? { strokeWidth: 2 } : {}) }, live ? "tstroke" : undefined)
        }
      />
      {o.stroke ? (
        <NumberField
          label="Espessura do contorno"
          value={o.strokeWidth ?? 1}
          min={0}
          onCommit={(v) => style({ strokeWidth: v })}
        />
      ) : null}
      <ColorField
        label="Fundo do texto"
        value={o.background ?? null}
        allowNone
        swatches={swatches}
        onChange={(c, live) => style({ background: c }, live ? "tbg" : undefined)}
      />
      <label className="flex items-center gap-2 text-xs text-fg-muted">
        <input
          type="checkbox"
          checked={!!o.autoWidth}
          onChange={(e) =>
            actions.update(
              o.id,
              e.target.checked ? { autoWidth: true } : {},
              undefined,
              e.target.checked ? undefined : ["autoWidth"],
            )
          }
        />
        Largura automática (sem quebra de linha)
      </label>
      <p className="text-[11px] text-fg-subtle">Clique duas vezes no texto para editar o conteúdo.</p>
    </Section>
  );
}

function ImageSection({
  o,
  actions,
  swatches,
  onReplace,
}: {
  o: ImageObject;
  actions: EditorActions;
  swatches: string[];
  onReplace: () => void;
}) {
  const known = !!o.naturalWidth && !!o.naturalHeight;
  // Zoom e foco aproximados a partir do recorte atual (para os controles deslizantes).
  const crop = o.crop;
  let zoom = 1;
  let fx = 0.5;
  let fy = 0.5;
  if (crop && known) {
    const ratio = o.width / Math.max(o.height, 1e-6);
    const coverW = Math.min(o.naturalWidth!, o.naturalHeight! * ratio);
    zoom = Math.max(1, Math.round((coverW / crop.width) * 100) / 100);
    fx = (crop.x + crop.width / 2) / o.naturalWidth!;
    fy = (crop.y + crop.height / 2) / o.naturalHeight!;
  }
  const fit = (mode: "fill" | "fit" | "stretch", z = zoom, x = fx, y = fy, live?: boolean) =>
    actions.store.dispatch([{ op: "imageFit", id: o.id, mode, zoom: z, focusX: x, focusY: y }], {
      coalesce: live ? `crop:${o.id}` : undefined,
      label: "Enquadrar imagem",
    });
  return (
    <Section title="Imagem">
      <Button size="sm" variant="secondary" onClick={onReplace}>
        <ImageUp /> Trocar imagem
      </Button>
      <div className="flex gap-1 text-[11px]">
        <Button
          size="xs"
          variant={crop ? "secondary" : "ghost"}
          disabled={!known}
          onClick={() => fit("fill", 1, 0.5, 0.5)}
        >
          Preencher
        </Button>
        <Button size="xs" variant="ghost" disabled={!known} onClick={() => fit("fit")}>
          Encaixar
        </Button>
        <Button size="xs" variant="ghost" onClick={() => fit("stretch")}>
          Esticar
        </Button>
      </div>
      {crop && known ? (
        <div className="grid gap-2">
          <RangeField
            label="Zoom do recorte"
            value={zoom}
            min={1}
            max={5}
            step={0.05}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(v) => fit("fill", v, fx, fy, true)}
          />
          <RangeField
            label="Posição horizontal"
            value={fx}
            min={0}
            max={1}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(v) => fit("fill", zoom, v, fy, true)}
          />
          <RangeField
            label="Posição vertical"
            value={fy}
            min={0}
            max={1}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(v) => fit("fill", zoom, fx, v, true)}
          />
        </div>
      ) : null}
      <NumberField
        label="Arredondamento"
        value={o.radius ?? 0}
        min={0}
        onCommit={(v) => actions.setStyle({ radius: v })}
      />
      <ColorField
        label="Borda"
        value={o.stroke ?? null}
        allowNone
        swatches={swatches}
        onChange={(c) => actions.setStyle({ stroke: c, ...(c && !o.strokeWidth ? { strokeWidth: 4 } : {}) })}
      />
      {o.stroke ? (
        <NumberField
          label="Espessura da borda"
          value={o.strokeWidth ?? 1}
          min={0}
          onCommit={(v) => actions.setStyle({ strokeWidth: v })}
        />
      ) : null}
    </Section>
  );
}

function InstanceSection({
  o,
  store,
  actions,
}: {
  o: Extract<DesignObject, { type: "instance" }>;
  store: EditorStore;
  actions: EditorActions;
}) {
  const comp = store.doc.components.find((c) => c.id === o.componentId);
  const texts = instanceChildren(store.doc, o)
    .flatMap(function flat(c): DesignObject[] {
      return c.type === "group" ? c.children.flatMap(flat) : [c];
    })
    .filter((c): c is TextObject => c.type === "text");
  return (
    <Section title={`Componente: ${comp?.name ?? "removido"}`}>
      <p className="text-xs text-fg-muted">
        Alterações no componente valem para todas as instâncias. Aqui você troca só os textos desta.
      </p>
      {texts.map((t) => (
        <label key={t.id} className="grid gap-1 text-[11px] text-fg-subtle">
          {t.name}
          <textarea
            defaultValue={t.text}
            rows={2}
            onBlur={(e) => {
              if (e.currentTarget.value !== t.text)
                store.dispatch(
                  [{ op: "overrideInstance", id: o.id, childId: t.id, set: { text: e.currentTarget.value } }],
                  { label: "Texto da instância" },
                );
            }}
            className="rounded-md border border-border bg-surface px-2 py-1 text-sm"
          />
        </label>
      ))}
      <div className="flex flex-wrap gap-1.5">
        {o.overrides ? (
          <Button
            size="xs"
            variant="secondary"
            onClick={() =>
              store.dispatch([{ op: "update", id: o.id, set: {}, unset: ["overrides"] }], {
                label: "Restaurar instância",
              })
            }
          >
            <X /> Restaurar textos
          </Button>
        ) : null}
        <Button size="xs" variant="secondary" onClick={actions.detach}>
          <Unlink /> Desvincular
        </Button>
      </div>
    </Section>
  );
}

function PageProperties({
  store,
  actions,
  swatches,
}: {
  store: EditorStore;
  actions: EditorActions;
  swatches: string[];
}) {
  const page = useEditor(store, (s) => s.activePage);
  const doc = useEditor(store, (s) => s.doc);
  const view = useEditor(store, (s) => s.view);
  const carousel = !!doc.meta?.carousel;
  const preset = FORMAT_PRESETS.find((p) => p.width === page.width && p.height === page.height);
  const index = doc.pages.findIndex((p) => p.id === page.id);
  const guides = page.guides ?? { v: [], h: [] };
  return (
    <div>
      <Section title={`Página ${index + 1} de ${doc.pages.length}`}>
        <input
          key={page.id}
          aria-label="Nome da página"
          defaultValue={page.name}
          onBlur={(e) => actions.renamePage(page.id, e.currentTarget.value)}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          className="h-8 w-full rounded-md border border-border bg-surface px-2 text-sm"
        />
        <SelectField
          label="Formato"
          value={preset?.key ?? "custom"}
          onChange={(k) => {
            const p = findPreset(k);
            if (p) actions.setPageSize(p.width, p.height);
          }}
          options={[
            ...FORMAT_PRESETS.filter((p) => !p.carousel).map((p) => ({
              value: p.key,
              label: `${p.label} — ${p.width}×${p.height}`,
            })),
            { value: "custom", label: "Personalizado" },
          ]}
        />
        <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
          <NumberField
            label="Largura"
            value={page.width}
            min={16}
            max={10000}
            suffix="px"
            onCommit={(v) => actions.setPageSize(v, page.height)}
          />
          <NumberField
            label="Altura"
            value={page.height}
            min={16}
            max={10000}
            suffix="px"
            onCommit={(v) => actions.setPageSize(page.width, v)}
          />
          <IconToggle label="Inverter orientação" onClick={() => actions.setPageSize(page.height, page.width)}>
            <FlipHorizontal2 className="rotate-90" />
          </IconToggle>
        </div>
        {carousel ? (
          <p className="text-[11px] text-fg-subtle">No carrossel o tamanho vale para todas as páginas.</p>
        ) : null}
      </Section>
      <Section title="Fundo">
        <PaintField
          label="Cor de fundo"
          value={page.background}
          swatches={swatches}
          onChange={(p, live) => p && actions.setBackground(p, live ? `bg:${page.id}` : undefined)}
        />
      </Section>
      <Section title="Carrossel">
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={carousel}
            onChange={(e) => actions.setCarousel(e.target.checked)}
            className="mt-1"
          />
          <span>
            Páginas conectadas
            <span className="block text-xs text-fg-muted">
              Mesmo tamanho em todas e elementos podem continuar de uma página para a seguinte (efeito panorâmico).
            </span>
          </span>
        </label>
        <Button size="xs" variant="secondary" onClick={() => actions.addPage()}>
          <Plus /> Nova página
        </Button>
      </Section>
      <Section
        title="Guias"
        actions={
          <div className="flex gap-2 text-[11px]">
            <button type="button" className="text-accent-text hover:underline" onClick={() => actions.addGuide("v")}>
              + Vertical
            </button>
            <button type="button" className="text-accent-text hover:underline" onClick={() => actions.addGuide("h")}>
              + Horizontal
            </button>
          </div>
        }
      >
        {guides.v.length + guides.h.length === 0 ? (
          <p className="text-xs text-fg-muted">Arraste a partir das réguas ou use os botões acima.</p>
        ) : (
          <ul className="grid gap-1.5">
            {(["v", "h"] as const).flatMap((axis) =>
              guides[axis].map((g, i) => (
                <li key={`${axis}${i}`} className="flex items-end gap-2">
                  <NumberField
                    className="flex-1"
                    label={axis === "v" ? "Guia vertical (X)" : "Guia horizontal (Y)"}
                    value={g}
                    onCommit={(v) =>
                      actions.setGuides({ ...guides, [axis]: guides[axis].map((x, j) => (j === i ? v : x)) })
                    }
                  />
                  <IconToggle
                    label="Remover guia"
                    onClick={() => actions.setGuides({ ...guides, [axis]: guides[axis].filter((_, j) => j !== i) })}
                  >
                    <X />
                  </IconToggle>
                </li>
              )),
            )}
          </ul>
        )}
      </Section>
      <Section title="Precisão">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={view.snap} onChange={(e) => store.setView({ snap: e.target.checked })} />
          Alinhamento magnético
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={view.grid} onChange={(e) => store.setView({ grid: e.target.checked })} />
          Mostrar grade
        </label>
        {view.grid ? (
          <NumberField
            label="Tamanho da grade"
            value={view.gridSize}
            min={2}
            max={500}
            suffix="px"
            onCommit={(v) => store.setView({ gridSize: Math.round(v) })}
          />
        ) : null}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={view.rulers} onChange={(e) => store.setView({ rulers: e.target.checked })} />
          Réguas
        </label>
      </Section>
    </div>
  );
}
