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

### 4.1 Problemas da seção 3

| # | Estado | O que foi feito (item em `docs/CHANGELOG.md`) |
| --- | --- | --- |
| 1 | ✅ | Painéis recolhíveis e recolhimento automático com o chat aberto; canvas de 380 → 636 px em 1024 px (#1). |
| 2 | ✅ | Indicador de salvamento em uma linha (`xl:whitespace-nowrap`) (#1). |
| 3 | ✅ | Validação, redução e recompressão no navegador e mensagens específicas por erro (#3). |
| 4 | ✅ | Menu lateral com cabeçalho, organização, recolher e nova ordem (#4). |
| 5 | ✅ | Categorias de clientes com migração aditiva 0016 (#5). |
| 6 | ✅ | Tela Minhas demandas (#6). |
| 7 | ✅ | Dashboard com Estúdio, atalhos, projetos recentes e atividade com links (#11). |
| 8 | ✅ | Calendário no menu e criação a partir de um dia (#12). |
| 9 | ✅ | Artes da demanda e aba Artes no projeto (#10). |
| 10 | ✅ | Guia “Me guie” com passos reais (#16). |
| 11 | ⏳ | Pendente: inserir imagem gerada direto no editor, transformar texto do assistente em demanda, enviar o projeto na geração de imagem, histórico sem JSON cru. |
| 12 | 🟡 | Página Atualizações criada (#14 a #16 e anteriores). Histórico de atividades da agência continua no Dashboard e em cada registro; não há uma página única. |
| 13 | ⏳ | Pendente: artes do Estúdio na busca global. |
| 14 | ⏳ | Pendente: confirmação ao excluir pasta; mudar cliente/projeto de um arquivo depois do envio. |
| 15 | ⏳ | Pendente: tema “Sistema” acompanhando o sistema operacional sem recarregar; cor de destaque. |
| 16 | ⏳ | Pendente: etiquetas, arquivados, ordenação e grade com miniaturas em Projetos. |
| 17 | ⏳ | Pendente: preferência da OpenAI sobre a demonstração em tarefas estruturadas. |
| 18 | ⏳ | Fora do escopo desta fase: Vendas/CRM e publicação em redes sociais. O menu não aponta para módulos inexistentes. |

### 4.2 Pedidos posteriores (prompts complementares)

| Pedido | Estado | Item |
| --- | --- | --- |
| Portal do cliente com login no estilo da referência e página de demandas só do cliente | ✅ | #7, #8 |
| Aprovação por link, sem conta | ✅ | #9 |
| Rotina (tarefas recorrentes) | ✅ | #13 |
| Referências por link na Biblioteca | ✅ | #14 |
| Notificações de prazo sem empilhar | ✅ | #15 |
| Página de atualizações só com o que foi testado | ✅ | `/w/[org]/updates` + `tests/changelog.test.ts` |
| CRM / Vendas | ⏳ | Não iniciado (não escolhido nas prioridades). |
| Publicação no Instagram, integração com Google Drive, conexão com Claude/ChatGPT (MCP), Fórum | ⏳ | Não iniciados; nenhum botão ou menu foi criado para eles. |
| Assistente de IA no editor com propor → prévia → aplicar/cancelar → histórico | ✅ (já existia) | `design-ai-chat.tsx`: cada resposta é uma proposta com prévia antes/depois, aplicar ou cancelar, desfazer e histórico. Mantido sem alteração. |

### 4.3 Validação final (22/10/2026)

- `npm run typecheck`: sem erros.
- `npm run lint`: sem erros.
- `npm test`: 54 arquivos, 474 testes aprovados (Postgres real).
- `npm run build`: concluído.
- Playwright (desktop 1360×860 e celular 390×844): ver resultado abaixo.

### 4.4 Estúdio Criador e chat flutuante (23/10/2026)

| Pedido | Estado | Onde |
| --- | --- | --- |
| Renomear o módulo para Estúdio Criador (menu, títulos, dashboard, guia, histórico) | ✅ | #17 |
| Página inicial: "Criar posts com IA", cartões Novo vertical (9:16) e Novo post (4:5 com carrossel) | ✅ | #17 — o destaque abre o gerador real; sem IA configurada a tela do gerador avisa |
| Galeria de modelos por categoria, com miniatura real, formato, prévia, "Usar modelo", busca e filtros | ✅ | #17 — modelos da agência (`designs.is_template`) e biblioteca de modelos; carregamento progressivo |
| Editor: canvas proporcional e visível, zoom, aparência escura, faixa de slides do carrossel | ✅ | #18 — canvas medido em 1440/1024/390 px |
| Chat flutuante em qualquer módulo (inclusive editor), minimizar/restaurar/fechar, estado preservado | ✅ | #19 — iframe do mesmo site em `/chat-dock/[org]`, mesmas permissões |
| Pop-ups de notificação (mensagens e eventos) no canto superior direito, com limite e agrupamento | ✅ | #19 — mensagens já existiam; eventos do sino passam a aparecer |
| Tempo real | ✅ (já existia) | Consulta periódica adaptativa (4–8 s); sem WebSocket na hospedagem serverless |
| Som configurável, sem repetir, respeitando bloqueio do navegador | ✅ (já existia) | `notification-sound.ts`, preferências em Conta → Avisos |
| Categorias sugeridas (Aesthetic, Minimalista, Editorial, …) | ✅ | `template-categories.ts`; categorias antigas mapeadas, sem duplicar registros |
| Barra lateral do editor com "Texto / Elementos / Botões / Fotos" como na referência | 🟡 | Mantida a organização atual (Adicionar, Camadas, Marca, Imagens, Componentes, Modelos), que cobre os mesmos recursos |
| Alternar o formato do documento no cabeçalho do editor (Vertical 9:16 / Post 4:5) | ⏳ | O formato muda no painel de propriedades da página; não foi adicionado atalho no cabeçalho |

Problema encontrado e corrigido nesta etapa: as seções da galeria (itens de grade)
sem `min-w-0` alargavam a página no celular (390 → 760 px) e deixavam botões de
caixas de diálogo fora de alcance; `expectNoHorizontalScroll` passou a comparar
com a largura real da janela para detectar isso.

Validação desta etapa (23/10/2026):

- `npm run typecheck` e `npm run lint`: sem erros.
- `npm test`: 55 arquivos, 478 testes aprovados.
- Playwright: suítes do Estúdio (editor, biblioteca de modelos, nuvem, IA de artes,
  Radar de Marca, gerador de carrosséis): 55 aprovados na primeira rodada; as 8
  falhas (nuvem no celular e um aviso na lixeira) vieram do alargamento da página
  descrito acima e passaram todas após a correção. Leva seguinte (nuvem, início do
  Estúdio, chat flutuante, avisos do chat, chat, pré-visualização, Radar de
  Tendências, Radar de Marca): 66 aprovados; as falhas do chat flutuante eram do
  roteiro de teste (corrigido; 9 aprovados + 1 pulado na repetição). Pré-visualização
  e Radar de Tendências, pendentes da etapa anterior, passaram com as sementes
  `e2e/seed-preview.ts` e `e2e/seed-trends.ts`.
- Radar de Marca no celular: a suíte completa passou (5 aprovados + 1 pulado) depois
  de duas correções: o teste de "Tarefa criada" conferia o botão em vez do aviso, e a
  página do relatório alargava a tela em 390 px (corrigido no código, item #20).
- `npm run build`: concluído, com a rota nova `/chat-dock/[org]`.
