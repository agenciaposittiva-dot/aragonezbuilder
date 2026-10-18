# ADR 0001 — Stack

**Status:** aceita · 18/10/2026

## Contexto
Repositório vazio. Requisitos: SaaS multiagência, TypeScript estrito, formulários com
validação, relatórios, editor gráfico, IA, filas, armazenamento privado e testes.

## Decisão
- **Next.js 16 (App Router) + React 19 + TypeScript estrito** — um único projeto para
  interface, Server Actions (camada de controle) e Route Handlers (upload, download,
  streaming de IA, cron).
- **Tailwind CSS 4** com tokens em CSS e componentes próprios sobre **Radix UI**
  (mesma abordagem do shadcn/ui, sem gerador).
- **PostgreSQL + Drizzle ORM** — SQL explícito, migrações versionadas geradas pelo
  drizzle-kit e suporte natural a chaves compostas, índices parciais e RLS.
- **Better Auth** — biblioteca madura de autenticação (sucessora natural do Auth.js),
  com e-mail/senha, redefinição de senha, verificação de e-mail, sessões em banco
  revogáveis e limite de tentativas.
- **Zod** (validação compartilhada cliente/servidor), **React Hook Form**,
  **@dnd-kit** (Kanban), **Recharts** (relatórios), **Fabric.js** (editor de artes),
  **pg-boss** (fila no próprio Postgres, sem Redis), **sharp** (miniaturas),
  **nodemailer** (SMTP), **@aws-sdk/client-s3** (S3/R2/MinIO/Supabase Storage),
  **@anthropic-ai/sdk** (IA).
- **Vitest** com banco Postgres real para testes de serviço e isolamento;
  **Playwright** para testes de navegador.

## Consequências
- Sem dependência de serviços extras para começar: Postgres resolve dados, fila e
  limites de requisição.
- TanStack Query não foi adotado: os dados vêm de Server Components e as mutações de
  Server Actions com atualização otimista onde importa (Kanban).
