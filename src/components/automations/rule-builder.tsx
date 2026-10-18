"use client";

import { ArrowDown, Plus, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox, Switch } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { useWorkspace } from "@/components/shell/workspace-context";
import { useOrgAction } from "@/hooks/use-action";
import { EVENT_CATALOG, type EventField, type EventType } from "@/lib/events";
import {
  ACTION_LABEL,
  ACTION_TYPES,
  CONDITION_OP_LABEL,
  CONDITION_OPS,
  type ActionInput,
  type ConditionInput,
  type RuleInput,
} from "@/lib/validators/automations";
import { saveRuleAction } from "@/server/actions/automations";

export type BuilderOptions = {
  members: { id: string; name: string }[];
  roles: { key: string; name: string }[];
  taskStatuses: { key: string; name: string }[];
  projectStatuses: { key: string; name: string }[];
  clients: { id: string; name: string }[];
  projects: { id: string; name: string }[];
};

const GROUPS: { prefix: string; label: string }[] = [
  { prefix: "task.", label: "Tarefas" },
  { prefix: "approval.", label: "Aprovações" },
  { prefix: "request.", label: "Solicitações" },
  { prefix: "project.", label: "Projetos" },
  { prefix: "file.", label: "Arquivos" },
  { prefix: "comment.", label: "Comentários" },
  { prefix: "client.", label: "Clientes" },
  { prefix: "invoice.", label: "Financeiro" },
  { prefix: "design.", label: "Editor" },
  { prefix: "member.", label: "Equipe" },
];

const EVENT_TYPES = Object.keys(EVENT_CATALOG) as EventType[];

function defaultAction(type: ActionInput["type"]): ActionInput {
  switch (type) {
    case "notify_members":
      return { type, title: "", toAssignee: true };
    case "notify_client":
      return { type, title: "", email: false };
    case "email":
      return { type, to: "assignee", subject: "", body: "" };
    case "create_task":
      return { type, title: "" };
    case "set_task_status":
      return { type, statusKey: "" };
    case "assign_task":
      return { type, membershipId: "", onlyIfUnassigned: true };
    case "webhook":
      return { type, url: "https://" };
  }
}

/** Valor da condição conforme o tipo do campo do gatilho. */
function ConditionValue({
  field,
  value,
  onChange,
  options,
  multiple,
}: {
  field: EventField | undefined;
  value: ConditionInput["value"];
  onChange: (v: ConditionInput["value"]) => void;
  options: BuilderOptions;
  multiple: boolean;
}) {
  const choices: { value: string; label: string }[] | null = useMemo(() => {
    if (!field) return null;
    if (field.type === "enum" && field.options) return field.options;
    if (field.type === "boolean")
      return [
        { value: "true", label: "Sim" },
        { value: "false", label: "Não" },
      ];
    if (field.type === "uuid") {
      if (field.key === "clientId") return options.clients.map((c) => ({ value: c.id, label: c.name }));
      if (field.key === "projectId") return options.projects.map((p) => ({ value: p.id, label: p.name }));
      if (field.key.endsWith("MembershipId")) return options.members.map((m) => ({ value: m.id, label: m.name }));
    }
    if (field.key === "toStatus") {
      const list = field.label.includes("projeto")
        ? options.projectStatuses
        : [...options.taskStatuses, ...options.projectStatuses];
      return [...new Map(list.map((s) => [s.key, { value: s.key, label: s.name }])).values()];
    }
    return null;
  }, [field, options]);

  if (choices && multiple) {
    const selected = Array.isArray(value) ? value : typeof value === "string" && value ? value.split(",") : [];
    return (
      <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto rounded-md border border-border p-2">
        {choices.map((c) => {
          const on = selected.includes(c.value);
          return (
            <label key={c.value} className="flex items-center gap-1.5 rounded-full bg-surface-2 px-2 py-0.5 text-xs">
              <Checkbox
                checked={on}
                onCheckedChange={(v) => onChange(v ? [...selected, c.value] : selected.filter((x) => x !== c.value))}
              />
              {c.label}
            </label>
          );
        })}
      </div>
    );
  }
  if (choices) {
    return (
      <NativeSelect value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} aria-label="Valor">
        <option value="">Selecione…</option>
        {choices.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </NativeSelect>
    );
  }
  return (
    <Input
      value={String(value ?? "")}
      type={field?.type === "number" ? "number" : field?.type === "date" ? "date" : "text"}
      onChange={(e) =>
        onChange(field?.type === "number" && e.target.value !== "" ? Number(e.target.value) : e.target.value)
      }
      aria-label="Valor"
    />
  );
}

export function RuleBuilder({
  initial,
  options,
  ruleId,
}: {
  initial: RuleInput;
  options: BuilderOptions;
  ruleId?: string;
}) {
  const router = useRouter();
  const { orgSlug } = useWorkspace();
  const [rule, setRule] = useState<RuleInput>(initial);
  const save = useOrgAction(saveRuleAction, {
    success: ruleId ? "Automação salva" : "Automação criada",
    onSuccess: () => router.push(`/w/${orgSlug}/automations`),
  });
  const trigger = EVENT_CATALOG[rule.trigger as EventType];
  const fields: readonly EventField[] = trigger?.fields ?? [];
  const conditions = rule.conditions ?? [];

  const setCondition = (i: number, patch: Partial<ConditionInput>) =>
    setRule((r) => ({ ...r, conditions: (r.conditions ?? []).map((c, j) => (j === i ? { ...c, ...patch } : c)) }));
  const setAction = (i: number, next: ActionInput) =>
    setRule((r) => ({ ...r, actions: r.actions.map((a, j) => (j === i ? next : a)) }));

  return (
    <form
      className="grid gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        save.run({ ...rule, id: ruleId });
      }}
    >
      <Card>
        <CardContent className="grid gap-4 pt-5 sm:grid-cols-[minmax(0,1fr)_auto]">
          <Field label="Nome da automação" htmlFor="r-name" required error={save.fieldErrors.name}>
            <Input
              id="r-name"
              value={rule.name}
              onChange={(e) => setRule({ ...rule, name: e.target.value })}
              required
            />
          </Field>
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <Switch checked={rule.enabled ?? true} onCheckedChange={(v) => setRule({ ...rule, enabled: v })} />
            {(rule.enabled ?? true) ? "Ativa" : "Pausada"}
          </label>
          <Field label="Descrição" htmlFor="r-desc" className="sm:col-span-2">
            <Input
              id="r-desc"
              value={rule.description ?? ""}
              onChange={(e) => setRule({ ...rule, description: e.target.value })}
              placeholder="Opcional"
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>1. Quando</CardTitle>
            <CardDescription>O acontecimento que dispara a automação.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <NativeSelect
            value={rule.trigger}
            onChange={(e) => setRule({ ...rule, trigger: e.target.value, conditions: [] })}
            aria-label="Gatilho"
          >
            {GROUPS.map((g) => (
              <optgroup key={g.prefix} label={g.label}>
                {EVENT_TYPES.filter((t) => t.startsWith(g.prefix)).map((t) => (
                  <option key={t} value={t}>
                    {EVENT_CATALOG[t].label}
                  </option>
                ))}
              </optgroup>
            ))}
          </NativeSelect>
        </CardContent>
      </Card>

      <ArrowDown className="mx-auto size-4 text-fg-subtle" aria-hidden="true" />

      <Card>
        <CardHeader>
          <div>
            <CardTitle>2. Se (opcional)</CardTitle>
            <CardDescription>Todas as condições precisam ser verdadeiras. Sem condições, roda sempre.</CardDescription>
          </div>
          {fields.length ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() =>
                setRule({ ...rule, conditions: [...conditions, { field: fields[0]!.key, op: "eq", value: "" }] })
              }
              disabled={conditions.length >= 10}
            >
              <Plus /> Condição
            </Button>
          ) : null}
        </CardHeader>
        <CardContent>
          {!fields.length ? (
            <p className="text-sm text-fg-muted">Este gatilho não tem campos para filtrar.</p>
          ) : conditions.length === 0 ? (
            <p className="text-sm text-fg-muted">Sem condições.</p>
          ) : (
            <ul className="grid gap-3">
              {conditions.map((c, i) => {
                const field = fields.find((f) => f.key === c.field);
                return (
                  <li
                    key={i}
                    className="grid items-start gap-2 rounded-lg border border-border p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,11rem)_minmax(0,1.3fr)_auto]"
                  >
                    <NativeSelect
                      value={c.field}
                      onChange={(e) => setCondition(i, { field: e.target.value, value: "" })}
                      aria-label="Campo"
                    >
                      {fields.map((f) => (
                        <option key={f.key} value={f.key}>
                          {f.label}
                        </option>
                      ))}
                    </NativeSelect>
                    <NativeSelect
                      value={c.op}
                      onChange={(e) => setCondition(i, { op: e.target.value as ConditionInput["op"] })}
                      aria-label="Operador"
                    >
                      {CONDITION_OPS.map((op) => (
                        <option key={op} value={op}>
                          {CONDITION_OP_LABEL[op]}
                        </option>
                      ))}
                    </NativeSelect>
                    {c.op === "exists" ? (
                      <span className="pt-2 text-xs text-fg-subtle">—</span>
                    ) : (
                      <ConditionValue
                        field={field}
                        value={c.value}
                        options={options}
                        multiple={c.op === "in"}
                        onChange={(v) => setCondition(i, { value: v })}
                      />
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Remover condição"
                      onClick={() => setRule({ ...rule, conditions: conditions.filter((_, j) => j !== i) })}
                    >
                      <X />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <ArrowDown className="mx-auto size-4 text-fg-subtle" aria-hidden="true" />

      <Card>
        <CardHeader>
          <div>
            <CardTitle>3. Então</CardTitle>
            <CardDescription>
              As ações rodam em ordem. Use variáveis do evento entre chaves, por exemplo {"{{title}}"}, {"{{fileName}}"}
              , {"{{number}}"} ou {"{{evento}}"}.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3">
          {rule.actions.map((a, i) => (
            <div key={i} className="grid gap-3 rounded-lg border border-border p-3">
              <div className="flex items-center gap-2">
                <span className="tabular flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs font-semibold">
                  {i + 1}
                </span>
                <NativeSelect
                  value={a.type}
                  onChange={(e) => setAction(i, defaultAction(e.target.value as ActionInput["type"]))}
                  aria-label="Tipo de ação"
                >
                  {ACTION_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {ACTION_LABEL[t]}
                    </option>
                  ))}
                </NativeSelect>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Remover ação"
                  onClick={() => setRule({ ...rule, actions: rule.actions.filter((_, j) => j !== i) })}
                  disabled={rule.actions.length === 1}
                >
                  <Trash2 />
                </Button>
              </div>
              <ActionFields action={a} onChange={(next) => setAction(i, next)} options={options} />
            </div>
          ))}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="w-fit"
            onClick={() => setRule({ ...rule, actions: [...rule.actions, defaultAction("notify_members")] })}
            disabled={rule.actions.length >= 10}
          >
            <Plus /> Ação
          </Button>
        </CardContent>
      </Card>

      {save.fieldErrors._ ||
      Object.keys(save.fieldErrors).some((k) => k.startsWith("actions") || k.startsWith("conditions")) ? (
        <p role="alert" className="text-sm text-danger">
          {Object.entries(save.fieldErrors)
            .filter(([k]) => k !== "name")
            .map(([, v]) => v[0])
            .join(" · ")}
        </p>
      ) : null}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={() => router.push(`/w/${orgSlug}/automations`)}>
          Cancelar
        </Button>
        <Button type="submit" variant="primary" loading={save.pending}>
          Salvar automação
        </Button>
      </div>
    </form>
  );
}

function ActionFields({
  action,
  onChange,
  options,
}: {
  action: ActionInput;
  onChange: (a: ActionInput) => void;
  options: BuilderOptions;
}) {
  switch (action.type) {
    case "notify_members":
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Título da notificação" className="sm:col-span-2" required>
            <Input
              value={action.title}
              onChange={(e) => onChange({ ...action, title: e.target.value })}
              placeholder="Ex.: Solicitação urgente #{{number}}"
            />
          </Field>
          <Field label="Mensagem" className="sm:col-span-2">
            <Input
              value={action.body ?? ""}
              onChange={(e) => onChange({ ...action, body: e.target.value })}
              placeholder="Opcional"
            />
          </Field>
          <div className="grid content-start gap-2 text-sm">
            <span className="text-[13px] font-medium">Destinatários</span>
            <label className="flex items-center gap-2">
              <Checkbox
                checked={!!action.toAssignee}
                onCheckedChange={(v) => onChange({ ...action, toAssignee: v === true })}
              />
              Responsável pela tarefa
            </label>
            <label className="flex items-center gap-2">
              <Checkbox
                checked={!!action.toOwner}
                onCheckedChange={(v) => onChange({ ...action, toOwner: v === true })}
              />
              Responsável pelo projeto
            </label>
          </div>
          <div className="grid content-start gap-2 text-sm">
            <span className="text-[13px] font-medium">Papéis</span>
            <div className="flex flex-wrap gap-1.5">
              {options.roles.map((r) => {
                const on = action.roleKeys?.includes(r.key) ?? false;
                return (
                  <label
                    key={r.key}
                    className="flex items-center gap-1.5 rounded-full bg-surface-2 px-2 py-0.5 text-xs"
                  >
                    <Checkbox
                      checked={on}
                      onCheckedChange={(v) =>
                        onChange({
                          ...action,
                          roleKeys: v
                            ? [...(action.roleKeys ?? []), r.key]
                            : (action.roleKeys ?? []).filter((k) => k !== r.key),
                        })
                      }
                    />
                    {r.name}
                  </label>
                );
              })}
            </div>
          </div>
          <Field label="Pessoas específicas" className="sm:col-span-2">
            <div className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto rounded-md border border-border p-2">
              {options.members.map((m) => {
                const on = action.membershipIds?.includes(m.id) ?? false;
                return (
                  <label key={m.id} className="flex items-center gap-1.5 rounded-full bg-surface-2 px-2 py-0.5 text-xs">
                    <Checkbox
                      checked={on}
                      onCheckedChange={(v) =>
                        onChange({
                          ...action,
                          membershipIds: v
                            ? [...(action.membershipIds ?? []), m.id]
                            : (action.membershipIds ?? []).filter((k) => k !== m.id),
                        })
                      }
                    />
                    {m.name}
                  </label>
                );
              })}
            </div>
          </Field>
        </div>
      );
    case "notify_client":
      return (
        <div className="grid gap-3">
          <Field label="Título" required>
            <Input
              value={action.title}
              onChange={(e) => onChange({ ...action, title: e.target.value })}
              placeholder="Ex.: Novo material para aprovar: {{fileName}}"
            />
          </Field>
          <Field label="Mensagem">
            <Input value={action.body ?? ""} onChange={(e) => onChange({ ...action, body: e.target.value })} />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={!!action.email} onCheckedChange={(v) => onChange({ ...action, email: v === true })} />
            Enviar também por e-mail
          </label>
          <p className="text-xs text-fg-subtle">
            Vai para os usuários do cliente ligado ao evento, na área do cliente.
          </p>
        </div>
      );
    case "email":
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Para">
            <NativeSelect
              value={action.to}
              onChange={(e) => onChange({ ...action, to: e.target.value as typeof action.to })}
            >
              <option value="assignee">Responsável pela tarefa</option>
              <option value="owner">Responsável pelo projeto</option>
              <option value="client_users">Usuários do cliente</option>
            </NativeSelect>
          </Field>
          <Field label="Assunto" required>
            <Input value={action.subject} onChange={(e) => onChange({ ...action, subject: e.target.value })} />
          </Field>
          <Field label="Mensagem" className="sm:col-span-2" required>
            <Textarea rows={4} value={action.body} onChange={(e) => onChange({ ...action, body: e.target.value })} />
          </Field>
        </div>
      );
    case "create_task":
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Título da tarefa" className="sm:col-span-2" required>
            <Input
              value={action.title}
              onChange={(e) => onChange({ ...action, title: e.target.value })}
              placeholder="Ex.: Encerramento: {{name}}"
            />
          </Field>
          <Field label="Descrição" className="sm:col-span-2">
            <Textarea
              rows={2}
              value={action.description ?? ""}
              onChange={(e) => onChange({ ...action, description: e.target.value })}
            />
          </Field>
          <Field label="Responsável">
            <NativeSelect
              value={action.assigneeMembershipId ?? ""}
              onChange={(e) => onChange({ ...action, assigneeMembershipId: e.target.value || undefined })}
            >
              <option value="">Sem responsável</option>
              {options.members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Prazo (dias após o evento)">
            <Input
              type="number"
              min={0}
              max={365}
              value={action.dueInDays ?? ""}
              onChange={(e) =>
                onChange({ ...action, dueInDays: e.target.value === "" ? undefined : Number(e.target.value) })
              }
            />
          </Field>
          <p className="text-xs text-fg-subtle sm:col-span-2">A tarefa é criada no projeto ligado ao evento.</p>
        </div>
      );
    case "set_task_status":
      return (
        <Field label="Novo status da tarefa ligada ao evento" required>
          <NativeSelect value={action.statusKey} onChange={(e) => onChange({ ...action, statusKey: e.target.value })}>
            <option value="">Selecione…</option>
            {options.taskStatuses.map((s) => (
              <option key={s.key} value={s.key}>
                {s.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
      );
    case "assign_task":
      return (
        <div className="grid gap-3">
          <Field label="Responsável pela tarefa ligada ao evento" required>
            <NativeSelect
              value={action.membershipId}
              onChange={(e) => onChange({ ...action, membershipId: e.target.value })}
            >
              <option value="">Selecione…</option>
              {options.members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={action.onlyIfUnassigned !== false}
              onCheckedChange={(v) => onChange({ ...action, onlyIfUnassigned: v === true })}
            />
            Só quando a tarefa ainda não tiver responsável
          </label>
        </div>
      );
    case "webhook":
      return (
        <div className="grid gap-2">
          <Field label="URL (https)" required>
            <Input
              value={action.url}
              onChange={(e) => onChange({ ...action, url: e.target.value })}
              placeholder="https://exemplo.com/webhooks/aragonez"
            />
          </Field>
          <p className="text-xs text-fg-subtle">
            Enviamos um POST com o evento em JSON e o cabeçalho X-Aragonez-Signature (HMAC-SHA256). Endereços de rede
            interna são bloqueados e redirecionamentos não são seguidos.
          </p>
        </div>
      );
  }
}
