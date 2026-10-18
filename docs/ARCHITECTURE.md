# Arquitetura

## Visão geral

```
Navegador ──► Next.js (App Router)
              ├─ Server Components  → leem dados via serviços
              ├─ Server Actions     → camada de controle (validação + ator + transação)
              ├─ Route Handlers     → upload, download assinado, IA (streaming), cron, exportações
              └─ Serviços           → regras de negócio, permissões, auditoria, eventos
                    │
                    ▼
               PostgreSQL (RLS por organização, FKs compostas, índices)
                    │  domain_events (outbox) ──► Worker (pg-boss)
                    │                              ├─ notificações e e-mails
                    │                              ├─ automações
                    │                              ├─ miniaturas de arquivos
                    │                              └─ rotinas diárias (atrasos, faturas recorrentes)
                    ▼
               Armazenamento privado (pasta local ou S3/R2/MinIO/Supabase)
```

## Pastas

```
src/
  app/
    (auth)/            login, cadastro, recuperação de senha
    onboarding/        criação da agência
    invite/[token]/    aceite de convite
    w/[org]/           área da agência (sidebar + cabeçalho)
    portal/[org]/      área exclusiva do cliente
    api/               auth, uploads, arquivos, IA, cron, exportações
  components/
    ui/                design system (botões, formulários, diálogos, tabelas…)
    app/               componentes de aplicação (Kanban, calendário, linha do tempo, filtros…)
    shell/             navegação, busca global, notificações, perfil
    <módulo>/          componentes de cada módulo
  lib/                 código compartilhado cliente/servidor (permissões, validações, formatação)
  server/
    db/                cliente Drizzle, esquema, helpers de transação (withOrg/withSystem)
    auth/              Better Auth e sessão
    authz/             ator, permissões e escopo de dados
    actions/           Server Actions (controladores finos)
    services/          regras de negócio por módulo
    ai/                provedores de IA, preços e prompts
    events/            despacho de eventos, notificações (worker)
    storage/           drivers de armazenamento
    mail/              fila e modelos de e-mail
  worker/              processo do worker
drizzle/               migrações SQL versionadas (inclui RLS)
tests/                 testes de serviço/isolamento (Postgres real)
docs/                  arquitetura, decisões, segurança, implantação
```

## Fluxo de uma operação

1. A interface chama uma Server Action com `(orgSlug, entrada)`.
2. `orgAction` exige sessão, resolve o ator (vínculo ativo + papel + permissões),
   valida a entrada e abre uma transação com `app.org_id` (RLS).
3. O serviço verifica permissão e escopo, aplica as regras, grava os dados,
   a auditoria e o evento de domínio — tudo na mesma transação.
4. A action chama `refresh()`; a página atualizada volta na mesma resposta.
5. O worker consome o evento: notificações, e-mails, automações, miniaturas.

## Modelo de dados (resumo)

| Área | Tabelas |
|---|---|
| Identidade | `user`, `session`, `account`, `verification`, `rate_limit` |
| Organização | `organizations`, `roles`, `memberships`, `invitations`, `counters` |
| Fluxos | `workflow_statuses`, `workflow_transitions` |
| Clientes | `clients`, `client_contacts`, `client_members`, `client_access`, `client_services`, `brand_profiles` |
| Projetos e tarefas | `projects`, `project_members`, `project_stages`, `tasks`, `task_collaborators`, `task_checklist_items`, `task_dependencies`, `time_entries` |
| Solicitações | `briefing_templates`, `requests` |
| Arquivos e aprovações | `folders`, `files`, `file_versions`, `file_favorites`, `approvals` |
| Colaboração | `comments`, `notifications`, `audit_logs`, `domain_events`, `email_outbox` |
| IA e criação | `ai_usage`, `ai_generations`, `designs` |
| Automação | `automation_rules`, `automation_runs` |
| Financeiro | `invoices`, `expenses` (+ `client_services` como contratos, `time_entries.cost_cents`) |

Regras de integridade relevantes:
- uma aprovação pertence a **uma versão** de arquivo; índice único impede duas
  aprovações pendentes da mesma etapa para a mesma versão; nova versão marca as
  pendentes anteriores como `superseded`;
- números sequenciais por organização (solicitações, faturas) via `counters`;
- faturas recorrentes únicas por (serviço, competência);
- comentários têm exatamente um alvo (`CHECK num_nonnulls(...) = 1`).

## Design system

Tokens em `src/app/globals.css` (cores, sombras, raios, camadas, animações), tema claro
e escuro (`data-theme`), identidade preto + dourado da marca (`#F4BF2F`), sidebar
sempre escura. Componentes acessíveis sobre Radix UI; foco visível; respeita
"reduzir movimento".

## Decisões
Ver `docs/adr/`.
