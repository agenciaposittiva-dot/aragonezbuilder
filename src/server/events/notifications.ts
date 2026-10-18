import { and, eq } from "drizzle-orm";
import type { Tx } from "@/server/db";
import { domainEvents, emailOutbox, files, notifications } from "@/server/db/schema";
import { env } from "@/server/env";
import { renderEmail } from "@/server/mail";
import { preferencesFor } from "@/server/services/notification-preferences";
import { APP_NAME } from "@/lib/constants";
import { categoryOf, prefEnabled } from "@/lib/notification-prefs";
import { REQUEST_STATUS_LABEL, type RequestStatus } from "@/lib/validators/requests";
import {
  clientTeam,
  clientUsers,
  fileInfo,
  internalMembersWithPermission,
  membersByIds,
  membersWithRoles,
  orgSlug,
  projectInfo,
  projectTeamWithPermission,
  recipientByUserId,
  requestInfo,
  taskInfo,
  type Recipient,
} from "./recipients";

export type DomainEvent = typeof domainEvents.$inferSelect;

type Draft = {
  recipients: Recipient[];
  title: string;
  body?: string | null;
  /** Caminho para a equipe (sem o prefixo /w/slug). */
  internalPath?: string | null;
  /** Caminho para o cliente (sem o prefixo /portal/slug). null = cliente não recebe. */
  portalPath?: string | null;
  /** Também envia e-mail aos destinatários. */
  email?: boolean;
};

const str = (v: unknown) => (typeof v === "string" ? v : v === null || v === undefined ? "" : String(v));

/**
 * Regras de notificação por tipo de evento. Retorna rascunhos; quem chama
 * remove o autor do evento, deduplica e grava.
 */
async function draftsFor(tx: Tx, ev: DomainEvent): Promise<Draft[]> {
  const p = (ev.payload ?? {}) as Record<string, unknown>;
  const org = ev.organizationId;

  switch (ev.type) {
    case "task.assigned": {
      const to = await membersByIds(tx, org, [str(p.assigneeMembershipId)]);
      return [
        {
          recipients: to,
          title: "Nova tarefa atribuída a você",
          body: str(p.title) || null,
          internalPath: `/tasks/${str(p.taskId) || ev.entityId}`,
        },
      ];
    }

    case "task.status_changed": {
      if (p.toCategory !== "review") return [];
      const project = await projectInfo(tx, org, str(p.projectId));
      if (!project?.ownerMembershipId) return [];
      return [
        {
          recipients: await membersByIds(tx, org, [project.ownerMembershipId]),
          title: "Tarefa aguardando revisão",
          body: `${str(p.title)} · ${project.name}`,
          internalPath: `/tasks/${str(p.taskId) || ev.entityId}`,
        },
      ];
    }

    case "task.overdue": {
      return [
        {
          recipients: await membersByIds(tx, org, [str(p.assigneeMembershipId)]),
          title: "Tarefa atrasada",
          body: str(p.title) || null,
          internalPath: `/tasks/${str(p.taskId) || ev.entityId}`,
        },
      ];
    }

    case "approval.requested":
    case "approval.reminder": {
      const reminder = ev.type === "approval.reminder";
      const fileName = str(p.fileName) || "Material";
      if (p.stage === "client") {
        return [
          {
            // Só quem pode decidir (Aprovador, Administrador do cliente).
            recipients: await clientUsers(tx, org, str(p.clientId), { permission: "approvals.decide_client" }),
            title: reminder ? `Lembrete: ${fileName} aguarda sua aprovação` : `${fileName} aguarda sua aprovação`,
            body: reminder
              ? "Este material está pendente há mais de 2 dias."
              : "Revise o material e aprove ou peça ajustes.",
            portalPath: `/approvals`,
            email: true,
          },
        ];
      }
      const project = await projectInfo(tx, org, str(p.projectId));
      let recipients: Recipient[] = [];
      if (project) {
        recipients = [
          ...(await membersByIds(tx, org, [project.ownerMembershipId])),
          ...(await projectTeamWithPermission(tx, org, project.id, "approvals.decide_internal")),
        ];
      }
      if (!recipients.length) {
        const deciders = await internalMembersWithPermission(tx, org, "approvals.decide_internal");
        const managers = new Set((await membersWithRoles(tx, org, ["owner", "admin", "manager"])).map((m) => m.userId));
        recipients = deciders.filter((d) => managers.has(d.userId));
      }
      return [
        {
          recipients,
          title: reminder ? `Lembrete: revisão interna pendente` : `Revisão interna solicitada`,
          body: project ? `${fileName} · ${project.name}` : fileName,
          internalPath: p.fileId ? `/files/${str(p.fileId)}` : `/approvals`,
        },
      ];
    }

    case "approval.decided": {
      const approved = p.decision === "approved";
      const stageLabel = p.stage === "client" ? "pelo cliente" : "na revisão interna";
      const task = await taskInfo(tx, org, str(p.taskId));
      const project = await projectInfo(tx, org, str(p.projectId));
      const requester = await recipientByUserId(tx, org, str(p.requestedByUserId));
      const recipients = [
        ...(requester && requester.kind === "internal" ? [requester] : []),
        ...(await membersByIds(tx, org, [task?.assigneeMembershipId, project?.ownerMembershipId])),
      ];
      const version = p.versionNumber ? ` (v${str(p.versionNumber)})` : "";
      return [
        {
          recipients,
          title: approved
            ? `Aprovado ${stageLabel}: ${str(p.fileName)}${version}`
            : `Ajustes solicitados ${stageLabel}: ${str(p.fileName)}${version}`,
          body: !approved && p.note ? `Motivo: ${str(p.note)}` : null,
          internalPath: p.fileId ? `/files/${str(p.fileId)}` : `/approvals`,
          email: p.stage === "client",
        },
      ];
    }

    case "request.created": {
      if (p.createdByKind !== "client") return [];
      const recipients = [
        ...(await clientTeam(tx, org, str(p.clientId))),
        ...(await internalMembersWithPermission(tx, org, "requests.triage")),
      ];
      return [
        {
          recipients,
          title: `Nova solicitação #${str(p.number)}`,
          body: str(p.title) || null,
          internalPath: `/requests/${str(p.requestId) || ev.entityId}`,
          email: true,
        },
      ];
    }

    case "request.status_changed": {
      const to = str(p.toStatus) as RequestStatus;
      // Rascunho e envio partem do próprio cliente; o resto é andamento da agência.
      if (!(to in REQUEST_STATUS_LABEL) || to === "draft" || to === "submitted") return [];
      const req = await requestInfo(tx, org, str(p.requestId) || ev.entityId);
      if (!req) return [];
      return [
        {
          // Quem acompanha todas as solicitações do cliente + quem abriu esta.
          recipients: await clientUsers(tx, org, req.clientId, {
            permission: "requests.read",
            orUserId: req.createdByUserId,
          }),
          title: `Solicitação #${req.number}: ${REQUEST_STATUS_LABEL[to].toLowerCase()}`,
          body: str(p.title) || null,
          portalPath: `/requests/${req.id}`,
          email: true,
        },
      ];
    }

    case "file.shared": {
      if (p.shared !== true) return [];
      const file = await fileInfo(tx, org, str(p.fileId) || ev.entityId);
      if (!file?.shared) return [];
      return [
        {
          recipients: await clientUsers(tx, org, file.clientId, { permission: "files.read" }),
          title: `Novo material disponível: ${file.name}`,
          body: null,
          portalPath: `/files/${file.id}`,
          email: true,
        },
      ];
    }

    case "file.version_uploaded": {
      // Primeira versão não é "nova versão"; e só avisa o cliente sobre arquivos já compartilhados.
      if (!p.versionNumber || Number(p.versionNumber) < 2) return [];
      const actor = await recipientByUserId(tx, org, ev.actorUserId);
      if (actor?.kind !== "internal") return [];
      const file = await fileInfo(tx, org, str(p.fileId) || ev.entityId);
      if (!file?.shared) return [];
      return [
        {
          recipients: await clientUsers(tx, org, file.clientId, { permission: "files.read" }),
          title: `Nova versão de ${file.name} (v${str(p.versionNumber)})`,
          body: null,
          portalPath: `/files/${file.id}`,
        },
      ];
    }

    case "file.status_changed": {
      if (p.toStatus !== "final") return [];
      const file = await fileInfo(tx, org, str(p.fileId) || ev.entityId);
      if (!file?.shared) return [];
      return [
        {
          recipients: await clientUsers(tx, org, file.clientId, { permission: "files.read" }),
          title: `Material final disponível: ${file.name}`,
          body: null,
          portalPath: `/files/${file.id}`,
          email: true,
        },
      ];
    }

    case "member.joined": {
      const inviter = await recipientByUserId(tx, org, str(p.invitedByUserId));
      if (!inviter) return [];
      const joined = await recipientByUserId(tx, org, str(p.userId));
      const name = joined?.name ?? "Uma pessoa convidada";
      const clientIds = Array.isArray(p.clientIds) ? p.clientIds.map(String) : [];
      return [
        {
          recipients: [inviter],
          title: `Convite aceito: ${name} entrou${p.roleName ? ` como ${str(p.roleName)}` : ""}`,
          body: null,
          internalPath:
            p.roleKind !== "client" ? `/team` : clientIds.length === 1 ? `/clients/${clientIds[0]}/guests` : `/clients`,
          portalPath: `/equipe`,
          email: true,
        },
      ];
    }

    case "request.assigned": {
      return [
        {
          recipients: await membersByIds(tx, org, [str(p.assigneeMembershipId)]),
          title: "Solicitação atribuída a você",
          body: p.number ? `#${str(p.number)} · ${str(p.title)}` : str(p.title) || null,
          internalPath: `/requests/${str(p.requestId) || ev.entityId}`,
        },
      ];
    }

    case "comment.created":
      return commentDrafts(tx, ev, p);

    case "project.status_changed": {
      if (p.toCategory !== "done" && p.toCategory !== "review") return [];
      const done = p.toCategory === "done";
      return [
        {
          recipients: await clientUsers(tx, org, str(p.clientId), { permission: "projects.read" }),
          title: done ? `Projeto concluído: ${str(p.name)}` : `Projeto em aprovação: ${str(p.name)}`,
          body: null,
          portalPath: `/projects/${str(p.projectId) || ev.entityId}`,
        },
      ];
    }

    case "invoice.overdue": {
      return [
        {
          recipients: await internalMembersWithPermission(tx, org, "finance.write"),
          title: `Fatura #${str(p.number)} vencida`,
          body: null,
          internalPath: `/finance/invoices?status=overdue`,
        },
      ];
    }

    default:
      return [];
  }
}

async function commentDrafts(tx: Tx, ev: DomainEvent, p: Record<string, unknown>): Promise<Draft[]> {
  const org = ev.organizationId;
  const target = (p.target ?? {}) as { type?: string; id?: string };
  const internal = p.internal === true;
  const fromClient = p.authorKind === "client";
  const excerpt = str(p.excerpt) || null;
  const drafts: Draft[] = [];

  if (target.type === "task" && target.id) {
    const task = await taskInfo(tx, org, target.id);
    if (!task) return [];
    const project = await projectInfo(tx, org, task.projectId);
    drafts.push({
      recipients: await membersByIds(tx, org, [
        task.assigneeMembershipId,
        ...task.collaboratorIds,
        project?.ownerMembershipId,
      ]),
      title: `Novo comentário em "${task.title}"`,
      body: excerpt,
      internalPath: `/tasks/${task.id}`,
    });
    // Tarefas são internas: o cliente nunca é notificado.
    return drafts;
  }

  if (target.type === "project" && target.id) {
    const project = await projectInfo(tx, org, target.id);
    if (!project) return [];
    drafts.push({
      recipients: await membersByIds(tx, org, [project.ownerMembershipId]),
      title: `Novo comentário no projeto ${project.name}`,
      body: excerpt,
      internalPath: `/projects/${project.id}`,
    });
    if (fromClient)
      drafts.push({
        recipients: await clientTeam(tx, org, project.clientId),
        title: `Comentário do cliente em ${project.name}`,
        body: excerpt,
        internalPath: `/projects/${project.id}`,
      });
    if (!internal && !fromClient) {
      drafts.push({
        recipients: await clientUsers(tx, org, project.clientId, { permission: "projects.read" }),
        title: `Nova mensagem sobre ${project.name}`,
        body: excerpt,
        portalPath: `/projects/${project.id}`,
      });
    }
    return drafts;
  }

  if (target.type === "request" && target.id) {
    const req = await requestInfo(tx, org, target.id);
    if (!req) return [];
    const creator = await recipientByUserId(tx, org, req.createdByUserId);
    drafts.push({
      recipients: [
        ...(await membersByIds(tx, org, [req.assigneeMembershipId])),
        ...(creator && creator.kind === "internal" ? [creator] : []),
        ...(fromClient ? await clientTeam(tx, org, req.clientId) : []),
      ],
      title: `Novo comentário na solicitação #${req.number}`,
      body: excerpt,
      internalPath: `/requests/${req.id}`,
    });
    if (!internal && !fromClient) {
      drafts.push({
        recipients: await clientUsers(tx, org, req.clientId, {
          permission: "requests.read",
          orUserId: req.createdByUserId,
        }),
        title: `Nova mensagem na solicitação #${req.number}`,
        body: excerpt,
        portalPath: `/requests/${req.id}`,
      });
    }
    return drafts;
  }

  if (target.type === "file" && target.id) {
    const [file] = await tx
      .select({
        id: files.id,
        name: files.name,
        clientId: files.clientId,
        projectId: files.projectId,
        createdByUserId: files.createdByUserId,
        shared: files.sharedWithClient,
      })
      .from(files)
      .where(and(eq(files.organizationId, org), eq(files.id, target.id)));
    if (!file) return [];
    const project = await projectInfo(tx, org, file.projectId);
    const uploader = await recipientByUserId(tx, org, file.createdByUserId);
    drafts.push({
      recipients: [
        ...(uploader && uploader.kind === "internal" ? [uploader] : []),
        ...(await membersByIds(tx, org, [project?.ownerMembershipId])),
        ...(fromClient ? await clientTeam(tx, org, file.clientId) : []),
      ],
      title: fromClient ? `Comentário do cliente em ${file.name}` : `Novo comentário em ${file.name}`,
      body: excerpt,
      internalPath: `/files/${file.id}`,
    });
    if (!internal && !fromClient && file.shared) {
      drafts.push({
        recipients: await clientUsers(tx, org, file.clientId, { permission: "files.read" }),
        title: `Nova mensagem sobre ${file.name}`,
        body: excerpt,
        portalPath: `/files/${file.id}`,
      });
    }
    return drafts;
  }

  return drafts;
}

/**
 * Gera e grava as notificações de um evento (na transação do despachante).
 * - nunca notifica quem causou o evento;
 * - usuários de cliente só recebem quando há caminho no portal;
 * - comentários internos nunca chegam a usuários de cliente.
 */
export async function applyNotifications(tx: Tx, ev: DomainEvent): Promise<number> {
  const drafts = await draftsFor(tx, ev);
  if (!drafts.length) return 0;
  const slug = await orgSlug(tx, ev.organizationId);
  if (!slug) return 0;
  const internalComment = ev.type === "comment.created" && (ev.payload as { internal?: boolean })?.internal === true;
  const category = categoryOf(ev.type);
  const prefs = await preferencesFor(tx, ev.organizationId, [
    ...new Set(drafts.flatMap((d) => d.recipients.map((r) => r.userId))),
  ]);
  const seen = new Set<string>();
  const rows: (typeof notifications.$inferInsert)[] = [];
  const emails: (typeof emailOutbox.$inferInsert)[] = [];

  for (const d of drafts) {
    for (const r of d.recipients) {
      if (r.userId === ev.actorUserId) continue;
      if (seen.has(r.userId)) continue;
      let link: string | null = null;
      if (r.kind === "client") {
        if (internalComment || d.portalPath === undefined || d.portalPath === null) continue;
        link = `/portal/${slug}/ir${d.portalPath}`;
      } else {
        if (d.internalPath === undefined || d.internalPath === null) continue;
        link = `/w/${slug}${d.internalPath}`;
      }
      seen.add(r.userId);
      const userPrefs = prefs.get(r.userId);
      if (prefEnabled(userPrefs, "inApp", category)) {
        rows.push({
          organizationId: ev.organizationId,
          userId: r.userId,
          type: ev.type,
          title: d.title.slice(0, 300),
          body: d.body ? d.body.slice(0, 1000) : null,
          link,
          entityType: ev.entityType,
          entityId: ev.entityId,
        });
      }
      if (d.email && prefEnabled(userPrefs, "email", category)) {
        const { html, text } = renderEmail({
          title: d.title,
          paragraphs: [`Olá, ${r.name}.`, ...(d.body ? [d.body] : [])],
          action: { label: "Abrir na plataforma", url: `${env.APP_URL}${link}` },
        });
        emails.push({ to: r.email, subject: `${d.title} · ${APP_NAME}`, html, text });
      }
    }
  }
  if (rows.length) await tx.insert(notifications).values(rows);
  if (emails.length) await tx.insert(emailOutbox).values(emails);
  return rows.length;
}
