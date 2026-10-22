# Auditoria da plataforma e plano de evolução (out/2026)

Pedido: "Transformar o Aragonez Builder em uma plataforma profissional de criação
com IA" + complemento "Reproduzir a organização do Modo Criador" (menu lateral,
categorias de clientes, Minhas demandas, calendário, avisos e guia "Me guie").

Este documento registra **o que foi encontrado antes de qualquer alteração**, a
lista priorizada de ajustes e o estado de cada um. Só entra como "concluído" o que
foi implementado **e** verificado (testes, typecheck, lint e/ou navegador).

## 1. Ambiente e linha de base (22/10/2026)

| Item | Resultado |
| --- | --- |
| Stack | Next.js 16.4 (App Router, Server Actions), React 19.3, TypeScript, Tailwind 4, Radix UI, Drizzle ORM + PostgreSQL 16 (RLS por organização), Better Auth, pg-boss (worker), Fabric.js 7 (editor), sharp, provedores de IA Anthropic/Gemini/OpenAI + demonstração local. |
| Multiagência | `/w/[org]` (agência) e `/portal/[org]` (cliente). Toda consulta passa por `inOrg` → transação com `app.org_id` e políticas RLS (`app_apply_tenant_rls`). |
| Typecheck | `npm run typecheck` → 0 erros (após `next typegen`, que gera os tipos `PageProps`). |
| Lint | `npm run lint` → 0 problemas. |
| Testes | `npm test` → **44 arquivos, 432 testes, todos passando** (Postgres real). |
| E2E | 20 specs Playwright (desktop 1360 px + Pixel 7). Dependem de `npm run dev` + seed. |

## 2. O que já existe e funciona (verificado no código e/ou no navegador)

- **Editor de artes (Estúdio)**: documento próprio `aragonez.design/2`, páginas lado a
  lado (carrossel conectado), camadas, grupos, componentes, guias, réguas, grade,
  alinhamento magnético, desfazer/refazer por operações, atalhos, menu de contexto,
  recorte de imagem, exportação PNG/JPG/PDF/ZIP, envio para Arquivos (nova versão),
  salvamento automático com rascunho local, conflito por revisão e histórico de versões.
- **Gerador de carrosséis com IA**: plano narrativo (gancho → desenvolvimento → CTA),
  direção visual coerente, elementos que atravessam a divisa entre slides,
  regenerar um slide, nova direção, segunda versão. Ver `docs/CARROSSEL-GERADOR.md`.
- **Chat de edição com IA** no editor: proposta → prévia antes/depois → aplicar ou
  cancelar → ponto de restauração no histórico → desfazer.
- **Importar JPG/PNG como modelo**: original em Arquivos + camada de fundo bloqueada;
  reconstrução em camadas só com modelo de visão (e diz isso quando não há).
- **Tarefas**: Minha visão, lista, quadro (arrastar), calendário mês/semana/dia com
  arrastar para mudar o prazo e bandeja "sem prazo", linha do tempo, prioridades,
  etiquetas, filtros salvos, modelos, dependências, subtarefas, apontamento de horas.
- **Etapas configuráveis** (Configurações → Fluxo de trabalho) para tarefas e projetos,
  com transições permitidas.
- **Avisos**: sino com não lidas, marcar como lida, atualização a cada 60 s; prazos
  próximos (hoje + 2 dias, uma vez por prazo) e atrasos diários pelo worker/cron.
- **Arquivos (Minha Nuvem)**: pastas, etiquetas, favoritos, miniaturas, filtros por
  tipo/cliente/projeto/status, grade e lista, versões, aprovações, portal do cliente.
- **IA**: chaves por agência criptografadas (AES-256-GCM) e nunca enviadas ao
  navegador; seletor de modelo por tarefa; geração de imagem real (OpenAI gpt-image);
  sem chave → mensagem "não configurado" (sem simular).
- **Tema claro/escuro/sistema**, menu lateral recolhível (cookie), busca global (⌘K).

## 3. Problemas encontrados

Medições feitas com Playwright no servidor local (`npm run dev` + `npm run db:seed`).

| # | Área | Problema | Causa | Prioridade |
| --- | --- | --- | --- | --- |
| 1 | Editor | Com o chat de IA aberto em 1024–1279 px o canvas fica com **380 px** (37% da tela) e a página aparece cortada. | Painel esquerdo fixo (304 px) + chat (340 px); o painel esquerdo não recolhe. | P0 |
| 2 | Editor | Indicador "Todas as alterações salvas" quebra em 3 linhas no cabeçalho entre 640 e 1279 px. | `sm:not-sr-only` do Tailwind redefine `white-space: normal`, anulando o `whitespace-nowrap`. | P0 |
| 3 | Estúdio | Importar JPG/PNG: arquivo grande ou em formato inválido só é recusado depois do envio; em hospedagem com limite de corpo (Vercel, 4 MB) a resposta do provedor não é JSON e a pessoa vê "Não foi possível importar a imagem." sem saber o motivo. Fotos grandes não são reduzidas. | Sem validação no navegador; erro 413 do provedor sem tratamento. | P0 |
| 4 | Navegação | Menu sem cabeçalho de plataforma, sem a organização "Minhas demandas / Dashboard / Clientes / Biblioteca / Estúdio / IA / Calendário"; botão de recolher só no rodapé. | — | P1 |
| 5 | Clientes | Não existem categorias de clientes (ativos, avulsos, ex-clientes, personalizadas). | Sem tabela/campo. | P1 |
| 6 | Demandas | Não há uma tela "Minhas demandas" com indicadores clicáveis, Lista/Minha semana e Por etapa/Por prazo. A "Minha visão" de Tarefas cobre parte disso. | — | P1 |
| 7 | Dashboard | Não mostra Estúdio (artes recentes, carrosséis em andamento), atalhos de criação nem projetos recentes; KPI "Tarefas atrasadas" leva a Relatórios; itens de atividade não são links. | — | P1 |
| 8 | Calendário | Existe dentro de Tarefas, mas sem entrada própria no menu e sem criação rápida a partir de uma data. | — | P1 |
| 9 | Estúdio × demandas | `designs.task_id`/`project_id` existem, mas nenhuma tarefa ou projeto lista as artes, e não há "Criar arte para esta demanda". | `listDesigns` sem filtro por projeto/tarefa. | P1 |
| 10 | Onboarding | Não há guia de primeiros passos. | — | P2 |
| 11 | IA | Imagem gerada não pode ser inserida no editor (só via Arquivos); texto do assistente não vira demanda; o projeto não é enviado na geração de imagem; histórico mostra JSON cru em respostas estruturadas. | — | P2 |
| 12 | Histórico | Não há página de atualizações da plataforma nem histórico de atividades da agência. | — | P2 |
| 13 | Busca | Artes do Estúdio não aparecem na busca global. | `search.ts` não consulta `designs`. | P2 |
| 14 | Arquivos | Excluir pasta não pede confirmação; cliente/projeto do arquivo só é definido no envio. | — | P3 |
| 15 | Tema | "Sistema" não acompanha a troca do sistema operacional sem recarregar; sem cor de destaque personalizável. | Sem `matchMedia` listener. | P3 |
| 16 | Projetos | Sem etiquetas/categorias próprias, sem alternar arquivados na tela, sem ordenação escolhida, sem grade com miniaturas. | — | P3 |
| 17 | IA | Com OpenAI e demonstração ligados juntos, a seleção automática pode preferir a demonstração em tarefas estruturadas. | Capacidade `structured` da OpenAI marcada como "desconhecida". | P3 |
| 18 | Menu (referência) | "Vendas" (funil comercial) e "Redes sociais" com publicação não existem como módulos. | Fora do escopo atual. O menu aponta só para o que existe: Financeiro e Conteúdos. | Pendente |

## 4. Plano por etapas e estado

Legenda: ✅ concluído e verificado · 🟡 parcial · ⏳ planejado/pendente.

O estado de cada item é atualizado ao final de cada etapa. O detalhamento técnico de
cada mudança fica em `docs/CHANGELOG.md`.
