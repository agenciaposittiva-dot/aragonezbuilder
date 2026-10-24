# Publicação (deploy)

Guia para colocar a plataforma no ar. O caminho mais curto é a Vercel com um
banco Postgres da Neon conectado pelo próprio painel.

Endereço de produção atual: **https://aragonezbuilderofc.vercel.app** (projeto
`aragonezbuilder` na Vercel). O código não fixa domínio nenhum: a aplicação usa
`APP_URL` e, sem ela, o endereço que a Vercel informa ao build.

## Vercel, passo a passo

1. **Projeto**: importe o repositório na Vercel. O `vercel.json` já define o
   framework (Next.js), a região (`gru1`, São Paulo), o comando de build e a
   rotina diária `/api/cron/tick`.
2. **Banco**: em **Storage → Create Database → Neon**, crie o banco e conecte-o
   ao projeto marcando **Production, Preview e Development**. A integração cria
   `DATABASE_URL` (e `DATABASE_URL_UNPOOLED`) automaticamente.
3. **Variáveis**: em **Settings → Environment Variables**, adicione no mínimo:

   | Variável | Obrigatória | Para quê |
   |---|---|---|
   | `BETTER_AUTH_SECRET` | sim | Segredo dos logins: texto aleatório de 32+ caracteres (`openssl rand -hex 32`). |
   | `ANTHROPIC_API_KEY` | não | Claude no assistente de IA. |
   | `GEMINI_API_KEY` | não | Google Gemini no assistente de IA. |
   | `OPENAI_API_KEY` | não | ChatGPT (OpenAI) no assistente de IA, inclusive geração de imagens (modelos gpt-image). |
   | `ARAGONEZ_ADMIN` / `ARAGONEZ_ADMIN_PASS` | recomendada | Conta administradora criada no deploy (e-mail e senha de 8+ caracteres). Como a plataforma é privada, é assim que nasce a primeira conta. |
   | `ACCESS_KEY` (ou `ACESS_KEY`) | não | Chave para criar novas agências (veja "Acesso somente por convite"). |
   | `CRON_SECRET` | recomendada | Protege `/api/cron/tick` (a Vercel envia o cabeçalho sozinha). |
   | `UPSTASH_REDIS_REST_URL` / `_TOKEN` | não | Limite de tentativas do login no Redis em vez do banco. |
   | `BLOB_STORE_ID` ou `BLOB_READ_WRITE_TOKEN` | não | Arquivos no Vercel Blob (privado). |
   | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | não | Envio de convites e recuperação de senha. |

   Marque cada variável para os ambientes em que o site roda. Um branch que
   não é o de produção gera deploys de **Preview**, que só enxergam variáveis
   marcadas como Preview (ou defina o branch em **Settings → Git → Production Branch**).
4. **Deploy**: a cada push, o build roda `npm run vercel-build`, que aplica as
   migrações no banco (se houver um configurado) e depois compila o Next.js.
5. **Conferência**: abra `/setup` no endereço publicado. A página mostra o que
   está configurado e o que falta, sem expor valores. Depois, entre com a conta
   administradora e crie a primeira agência.

### Como refazer o deploy (redeploy)

Útil depois de alterar variáveis de ambiente ou quando um build falhou por
motivo externo (rede, limite de tempo, banco indisponível).

- **Pelo painel da Vercel** (caminho mais rápido): **Deployments → ⋯ no último
  deploy → Redeploy**. Marque "Use existing Build Cache" só se nenhuma variável
  mudou; para aplicar variáveis novas, desmarque.
- **Por um commit**: qualquer commit na branch de produção dispara um build
  completo (`npm run vercel-build`, com migrações). É o que acontece a cada
  merge na branch padrão.
- **Conferência**: o deploy está no ar quando aparece como **Ready** no painel e
  `/setup` mostra, em "Deploy", o commit publicado (os 7 primeiros caracteres
  do SHA e a branch).

### Avisos no log de build

- **`"engines": { "node": ">=20.9" }` … will automatically upgrade** — o
  `package.json` fixa `22.x`, a versão que a Vercel usa hoje. Sem o intervalo
  aberto, uma nova versão maior do Node não entra sozinha no build.
- **install scripts not yet covered by allowScripts** — o npm 11 bloqueia os
  scripts de instalação de dependências não aprovadas. O campo `allowScripts`
  do `package.json` aprova `esbuild` e `unrs-resolver` (só validam o binário já
  baixado) e nega `canvas`, dependência opcional do Fabric usada apenas no
  navegador: o servidor nunca a carrega, então compilar o módulo nativo seria
  tempo de build perdido.
- **SECURITY WARNING: The SSL modes 'prefer', 'require'…** — vem do driver `pg`
  quando a URL do banco traz `sslmode=require` (padrão da Neon). A aplicação
  reescreve para `sslmode=verify-full`, exatamente o que o driver já aplicava;
  a conexão não muda e o aviso some (`src/server/db-url.ts`).
- **Unknown env config "cache-dir"** — variável do ambiente de build da Vercel,
  ignorada pelo npm. Não vem do projeto.

### Acesso somente por convite

A plataforma é privada: não existe cadastro aberto.

- **Contas** nascem só de convites. O administrador abre **Equipe → Convidar
  usuário**, escolhe a agência, o e-mail e o papel (e, para usuários de cliente,
  quais clientes). O link é de uso único, vale de 1 a 30 dias e pode ser
  reenviado ou cancelado em **Equipe → Convites** (abas Pendentes, Aceitos,
  Expirados e Revogados).
- **No servidor**, o Better Auth recusa qualquer criação de conta (inclusive
  pedidos diretos a `/api/auth/sign-up/email`) que não venha do fluxo de
  convite. Esse fluxo confere o token (no banco fica só o hash), usa o e-mail
  do convite, aplica o papel e os clientes definidos por quem convidou e limita
  tentativas por IP e por convite. O endereço `/signup` só mostra o aviso.
- **Novas agências** podem ser criadas pela conta `ARAGONEZ_ADMIN` e por quem já
  administra uma agência. Com `ACCESS_KEY` definida, criar agência exige a chave
  (exceto para a conta administradora). Convidados sem administração não criam
  agências por conta própria.
- **E-mail**: sem SMTP, os convites e a recuperação de senha não chegam por
  e-mail. A tela de convite mostra o link para o administrador copiar e enviar;
  configure `SMTP_*` para o envio automático.

### O que acontece sozinho na Vercel

- **Endereço público**: sem `APP_URL`, usa o endereço do deploy
  (`VERCEL_PROJECT_PRODUCTION_URL` em produção, o do branch em Preview). Todos
  os endereços do deploy são aceitos no login. Para domínio próprio, defina
  `APP_URL` (e, se quiser vários, `TRUSTED_ORIGINS`).
- **Isolamento entre agências (RLS)**: bancos criados pela integração têm um
  único usuário, dono das tabelas. As migrações criam o papel `aragonez_rls`
  (sem login, sem BYPASSRLS) e a aplicação o assume em cada transação
  (`SET LOCAL ROLE`), então as políticas valem mesmo com esse usuário.
- **Arquivos**: Vercel Blob privado se houver `BLOB_STORE_ID`/`BLOB_READ_WRITE_TOKEN`,
  senão o próprio Postgres (tabela `storage_objects`). Uploads ficam limitados a
  4 MB (limite de corpo das funções da Vercel). Para arquivos grandes, use S3.
- **Processamento em segundo plano**: notificações, automações, miniaturas e
  e-mails rodam logo após cada operação (`after()`), e a rotina diária cuida de
  lembretes e faturas recorrentes. No plano Hobby a Vercel só permite rotinas
  diárias; em outros planos, aumente a frequência no `vercel.json`.
- **Dados de outros projetos**: o Blob usa a pasta `aragonez/` e o Redis o
  prefixo `aragonez:`, então podem ser compartilhados com outros projetos.

## Servidor próprio (VPS, Docker, Railway…)

1. Postgres 16+ com dois papéis: o dono das tabelas (migrações e worker) e um
   papel de execução **sem** superusuário e **sem** BYPASSRLS:

   ```sql
   create role aragonez login password '...';
   create role aragonez_app login password '...' nobypassrls;
   create database aragonez owner aragonez;
   ```

2. `.env` a partir de `.env.example` (`DATABASE_URL` com `aragonez_app`,
   `DATABASE_OWNER_URL` com `aragonez`), depois:

   ```bash
   npm ci
   npm run db:migrate     # aplica migrações, RLS e permissões
   npm run build
   npm start              # aplicação
   npm run worker         # processo contínuo: eventos, e-mails e rotinas
   ```

3. Arquivos: `STORAGE_DRIVER=local` com volume persistente, ou S3 (`STORAGE_DRIVER=s3`).

## Dados de demonstração

`npm run db:seed` cria a agência fictícia "Estúdio Aurora" com equipe, clientes,
projetos, tarefas, solicitações, materiais em aprovação e lançamentos
financeiros. Só insere dados (para se a agência já existir). As contas usam a
senha de `SEED_PASSWORD`; por isso o script recusa rodar com
`NODE_ENV=production` sem `--allow-production`. Não use em um site público.

## Recuperação e cuidados

- **Migrações** são versionadas em `drizzle/` e só acrescentam estrutura. Antes
  de uma migração que altere ou remova dados, faça backup (a Neon permite
  restaurar o banco para um instante anterior; em servidor próprio, `pg_dump`).
- Para não aplicar migrações num build específico, defina `SKIP_DB_MIGRATE=1`.
- **Segredos**: trocar `BETTER_AUTH_SECRET` encerra todas as sessões e invalida
  links de download já emitidos. Sem `ENCRYPTION_KEY`, as chaves de IA salvas
  pelas agências (e as chaves pessoais, BYOK) são criptografadas com uma chave
  derivada do `BETTER_AUTH_SECRET`; defina `ENCRYPTION_KEY` (`openssl rand
  -base64 32`) antes de salvar chaves se quiser trocar o segredo depois. Trocar
  `ENCRYPTION_KEY` invalida as chaves de IA guardadas: elas precisam ser
  cadastradas de novo (procedimento em `docs/SECURITY.md`).
- A conta administradora nunca tem a senha alterada pelo deploy: para trocar,
  use "Esqueci minha senha" ou o perfil.
