import { sql, type SQL } from "drizzle-orm";
import { withSystem } from "@/server/db";
import { auditLogs, domainEvents, invoices } from "@/server/db/schema";
import { nextCounter } from "@/server/services/finance";
import { cleanupPendingChatAttachments } from "@/server/services/chat-attachments";
import { purgeExpiredTrash } from "@/server/services/trash";

/*
 * Rotinas agendadas (worker via pg-boss; ou /api/cron/tick em plataformas sem
 * processo contínuo). Todas são idempotentes: podem rodar várias vezes no dia.
 * Rodam com bypass de RLS e filtram/gravam organization_id explicitamente.
 */

const TZ = "America/Sao_Paulo";
const todaySql = sql.raw(`(now() at time zone '${TZ}')::date`);

/** Data de hoje (YYYY-MM-DD) no fuso da agência. */
function todayISO() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(),
  );
}

/** A organização não está na lixeira (rotinas não agem sobre agências excluídas). */
function orgAlive(orgIdColumn: SQL) {
  return sql`exists (select 1 from organizations o where o.id = ${orgIdColumn} and o.deleted_at is null)`;
}

/** Emite `task.overdue` uma vez por dia para cada tarefa aberta e atrasada. */
export async function scanOverdueTasks(): Promise<number> {
  const res = await withSystem((tx) =>
    tx.execute<{ id: string }>(sql`
      insert into domain_events (organization_id, type, entity_type, entity_id, payload)
      select t.organization_id, 'task.overdue', 'task', t.id,
        jsonb_build_object(
          'taskId', t.id, 'projectId', t.project_id, 'clientId', p.client_id, 'title', t.title,
          'assigneeMembershipId', t.assignee_membership_id, 'dueDate', t.due_date
        )
      from tasks t
      join projects p on p.id = t.project_id and p.organization_id = t.organization_id
      join workflow_statuses ws on ws.id = t.status_id and ws.organization_id = t.organization_id
      where t.completed_at is null
        and t.archived_at is null
        and p.deleted_at is null
        and ${orgAlive(sql`t.organization_id`)}
        and ws.category not in ('done', 'cancelled')
        and t.due_date < ${todaySql}
        and not exists (
          select 1 from domain_events e
          where e.organization_id = t.organization_id and e.type = 'task.overdue' and e.entity_id = t.id
            and (e.created_at at time zone ${TZ})::date = ${todaySql}
        )
      returning id
    `),
  );
  return res.rowCount ?? res.rows.length;
}

/** Janela do aviso de prazo próximo: hoje e os próximos 2 dias. */
export const DUE_SOON_DAYS = 2;

/**
 * Emite `task.due_soon` para tarefas abertas com prazo entre hoje e os
 * próximos dias. No máximo um aviso por tarefa e prazo: se o prazo mudar,
 * um novo aviso pode sair para a nova data.
 */
export async function scanDueSoonTasks(): Promise<number> {
  const res = await withSystem((tx) =>
    tx.execute<{ id: string }>(sql`
      insert into domain_events (organization_id, type, entity_type, entity_id, payload)
      select t.organization_id, 'task.due_soon', 'task', t.id,
        jsonb_build_object(
          'taskId', t.id, 'projectId', t.project_id, 'clientId', p.client_id, 'title', t.title,
          'assigneeMembershipId', t.assignee_membership_id, 'priority', t.priority, 'dueDate', t.due_date,
          'daysLeft', t.due_date - ${todaySql}
        )
      from tasks t
      join projects p on p.id = t.project_id and p.organization_id = t.organization_id
      join workflow_statuses ws on ws.id = t.status_id and ws.organization_id = t.organization_id
      where t.completed_at is null
        and t.archived_at is null
        and t.deleted_at is null
        and p.deleted_at is null
        and ${orgAlive(sql`t.organization_id`)}
        and ws.category not in ('done', 'cancelled')
        and t.due_date between ${todaySql} and ${todaySql} + ${sql.raw(String(DUE_SOON_DAYS))}
        and not exists (
          select 1 from domain_events e
          where e.organization_id = t.organization_id and e.type = 'task.due_soon' and e.entity_id = t.id
            and e.payload->>'dueDate' = t.due_date::text
        )
      returning id
    `),
  );
  return res.rowCount ?? res.rows.length;
}

/** Faturas em aberto com vencimento passado → "vencida" (+ auditoria e evento). */
export async function markOverdueInvoices(): Promise<number> {
  const res = await withSystem((tx) =>
    tx.execute<{ id: string }>(sql`
      with upd as (
        update invoices set status = 'overdue', updated_at = now()
        where status = 'open' and due_date < ${todaySql}
          and ${orgAlive(sql`invoices.organization_id`)}
          and not exists (select 1 from clients c where c.id = invoices.client_id and c.deleted_at is not null)
        returning id, organization_id, client_id, number, amount_cents, due_date
      ), audit as (
        insert into audit_logs (organization_id, action, entity_type, entity_id, summary)
        select organization_id, 'status_changed', 'invoice', id, 'Fatura #' || number || ' vencida'
        from upd
      )
      insert into domain_events (organization_id, type, entity_type, entity_id, payload)
      select organization_id, 'invoice.overdue', 'invoice', id,
        jsonb_build_object('invoiceId', id, 'clientId', client_id, 'number', number, 'amountCents', amount_cents, 'dueDate', due_date)
      from upd
      returning id
    `),
  );
  return res.rowCount ?? res.rows.length;
}

function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Gera as faturas mensais dos serviços recorrentes (dia de faturamento já
 * alcançado no mês). Idempotente: a restrição única (organização, serviço,
 * competência) impede duplicidade mesmo com execuções concorrentes.
 */
export async function generateRecurringInvoices(today = todayISO()): Promise<number> {
  const period = today.slice(0, 7);
  const day = Number(today.slice(8, 10));
  const candidates = await withSystem((tx) =>
    tx.execute<{
      id: string;
      organization_id: string;
      client_id: string;
      name: string;
      amount_cents: number;
      billing_day: number;
    }>(sql`
      select s.id, s.organization_id, s.client_id, s.name, s.amount_cents, s.billing_day
      from client_services s
      join clients c on c.id = s.client_id and c.organization_id = s.organization_id
      where s.status = 'active' and s.billing_type = 'monthly' and s.billing_day is not null and s.amount_cents > 0
        and c.archived_at is null
        and c.deleted_at is null
        and ${orgAlive(sql`s.organization_id`)}
        and (s.starts_on is null or s.starts_on <= ${today}::date)
        and (s.ends_on is null or s.ends_on >= ${today}::date)
        and s.billing_day <= ${day}
        and not exists (
          select 1 from invoices i
          where i.organization_id = s.organization_id and i.client_service_id = s.id and i.period = ${period}
        )
    `),
  );

  let created = 0;
  for (const s of candidates.rows) {
    const issueDate = `${period}-${String(Math.min(28, s.billing_day)).padStart(2, "0")}`;
    const dueDate = addDays(issueDate, 7);
    const [mm, yyyy] = [period.slice(5, 7), period.slice(0, 4)];
    const inserted = await withSystem(async (tx) => {
      // Trava o serviço para evitar número desperdiçado em execuções concorrentes.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`invoice:${s.id}:${period}`}))`);
      const exists = await tx.execute(sql`
        select 1 from invoices where organization_id = ${s.organization_id} and client_service_id = ${s.id} and period = ${period}
      `);
      if (exists.rows.length) return null;
      const number = await nextCounter(tx, s.organization_id, "invoice");
      const [row] = await tx
        .insert(invoices)
        .values({
          organizationId: s.organization_id,
          number,
          clientId: s.client_id,
          clientServiceId: s.id,
          description: `${s.name} · ${mm}/${yyyy}`,
          amountCents: s.amount_cents,
          issueDate,
          dueDate,
          period,
          status: "open",
        })
        .onConflictDoNothing()
        .returning({ id: invoices.id, number: invoices.number });
      if (!row) return null;
      await tx.insert(auditLogs).values({
        organizationId: s.organization_id,
        action: "created",
        entityType: "invoice",
        entityId: row.id,
        summary: `Fatura #${row.number} gerada automaticamente (${s.name}, ${mm}/${yyyy})`,
      });
      await tx.insert(domainEvents).values({
        organizationId: s.organization_id,
        type: "invoice.created",
        entityType: "invoice",
        entityId: row.id,
        payload: {
          invoiceId: row.id,
          clientId: s.client_id,
          number: row.number,
          amountCents: s.amount_cents,
          dueDate,
          recurring: true,
        },
      });
      return row;
    });
    if (inserted) created++;
  }
  return created;
}

/** Lembretes de aprovações pendentes há mais de 2 dias (no máximo um a cada 2 dias). */
export async function remindPendingApprovals(): Promise<number> {
  const res = await withSystem((tx) =>
    tx.execute<{ id: string }>(sql`
      insert into domain_events (organization_id, type, entity_type, entity_id, payload)
      select a.organization_id, 'approval.reminder', 'approval', a.id,
        jsonb_build_object(
          'approvalId', a.id, 'fileId', a.file_id, 'versionId', a.file_version_id, 'stage', a.stage,
          'clientId', f.client_id, 'projectId', f.project_id, 'taskId', a.task_id, 'fileName', f.name
        )
      from approvals a
      join files f on f.id = a.file_id and f.organization_id = a.organization_id
      where a.status = 'pending'
        and f.deleted_at is null
        and ${orgAlive(sql`a.organization_id`)}
        and (f.client_id is null or not exists (select 1 from clients c where c.id = f.client_id and c.deleted_at is not null))
        and (f.project_id is null or not exists (select 1 from projects p where p.id = f.project_id and p.deleted_at is not null))
        and a.requested_at < now() - interval '2 days'
        and not exists (
          select 1 from domain_events e
          where e.organization_id = a.organization_id and e.type = 'approval.reminder' and e.entity_id = a.id
            and e.created_at > now() - interval '2 days'
        )
      returning id
    `),
  );
  return res.rowCount ?? res.rows.length;
}

/** Executa todas as rotinas (idempotentes) — usado pelo endpoint de cron. */
export async function runDueSchedules() {
  return {
    overdueTasks: await scanOverdueTasks(),
    dueSoonTasks: await scanDueSoonTasks(),
    overdueInvoices: await markOverdueInvoices(),
    recurringInvoices: await generateRecurringInvoices(),
    approvalReminders: await remindPendingApprovals(),
    trash: await purgeExpiredTrash(),
    chatAttachments: await cleanupPendingChatAttachments(),
  };
}

export const SCHEDULES = [
  { name: "cron-task-overdue", cron: "15 7 * * *", run: scanOverdueTasks, label: "Tarefas atrasadas" },
  { name: "cron-task-due-soon", cron: "20 7 * * *", run: scanDueSoonTasks, label: "Prazos próximos" },
  { name: "cron-invoices-overdue", cron: "30 6 * * *", run: markOverdueInvoices, label: "Faturas vencidas" },
  {
    name: "cron-recurring-invoices",
    cron: "0 6 * * *",
    run: () => generateRecurringInvoices(),
    label: "Faturas recorrentes",
  },
  {
    name: "cron-approval-reminders",
    cron: "0 9,15 * * 1-5",
    run: remindPendingApprovals,
    label: "Lembretes de aprovação",
  },
  {
    name: "cron-chat-attachments",
    cron: "40 3 * * *",
    run: () => cleanupPendingChatAttachments(),
    label: "Anexos de chat não enviados",
  },
] as const;
