# Roadmap de evolução — Aragonez Builder

Plano priorizado e acompanhamento do "Projeto master — evolução completa".
Regra: nada é marcado **Concluído** sem comprovação (teste executado, build,
navegador). Cada entrega concluída entra também no registro de atualizações
(`src/lib/changelog.ts` ↔ `docs/CHANGELOG.md`, conferidos por
`tests/changelog.test.ts`) — este documento não substitui o changelog: ele
acompanha o que falta.

Estados: **Pendente** · **Em andamento** · **Bloqueado** · **Em validação** · **Concluído**.
Prioridades: **P0** (bloqueia uso) · **P1** (erro ou lacuna sentida no dia a dia)
· **P2** (valor claro, sem urgência) · **P3** (refinamento).

## 0. Linha de base (auditoria de 24/10/2026)

Executado neste ambiente (Postgres 16 local, Node 22, Chromium local), sobre o
branch `claude/cool-ramanujan-dci7cu` após a entrega #24 (Gerar imagem no editor):

| Verificação | Resultado |
| --- | --- |
| `npm run typecheck` | 0 erros |
| `npm run lint` | 0 problemas |
| `npm test` (Vitest, Postgres real) | 59 arquivos, **504 testes aprovados** |
| Backup/restauração (`scripts/backup-check.ts --env .env`) | **OK** — dump de 84 tabelas, 573 linhas conferidas, 40 versões de arquivo encontradas e 20 comparadas byte a byte em 3,0 s |
| `npm run build` | ver seção 0.1 |
| Playwright (desktop 1360×860 + Pixel 7) | ver seção 0.1 |

Documentação lida antes de qualquer mudança: `docs/ARCHITECTURE.md`, ADRs 0001–0008,
`docs/AUDITORIA-PLATAFORMA.md`, `docs/TASKS-AUDIT.md`, `docs/CLOUD-AUDIT.md`,
`docs/EDITOR-PLAN.md`, `docs/CARROSSEL-GERADOR.md`, `docs/PORTAL.md`,
`docs/BRAND-RADAR.md`, `docs/TRENDS-PLAN.md`, `docs/SECURITY.md`,
`docs/DEPLOY.md`, `docs/BACKUP.md`, `docs/CHANGELOG.md` (#1–#24).

### 0.1 Execuções longas (preenchido quando terminam)

| Execução | Resultado |
| --- | --- |
| `npm run build` (Turbopack, binário nativo) | **concluído** (24/10/2026) — compilação em 38,6 s, TypeScript e geração de páginas sem erros |
| Playwright, suíte ampla (editor, IA de artes, nuvem, Estúdio, modelos, carrosséis, tarefas, demandas, lixeira, guia, atualizações, aprovação por link, portal ×3, importação de cliente, rotinas, chat ×3, logo, foto de perfil, foto de grupo, convite, pré-visualização, tendências, Radar de Marca) | em execução — atualizar |
| Playwright `editor.spec.ts` + `image-generator.spec.ts` (24/10, antes desta auditoria) | 12/12 aprovados |

### 0.2 O que a auditoria confirmou como funcionando (ponta a ponta)

- Alteração no editor persiste após recarregar; imagens geradas continuam
  disponíveis em nova sessão (arquivos em Arquivos, `src: /api/files/<versão>`)
  — `e2e/editor.spec.ts`, `e2e/image-generator.spec.ts`, `tests/design-image-gen.test.ts`.
- Exportação PNG/PDF/ZIP a partir do documento salvo (não da tela) —
  `e2e/editor.spec.ts` "exportar"; limitação conhecida: PDF sem texto selecionável (E2-07).
- Isolamento entre organizações e clientes — `tests/tenant-isolation.test.ts`,
  `tests/client-portal.test.ts`, `tests/guests.test.ts`, `e2e/portal-acceptance.spec.ts`.
- Erros de IA compreensíveis (modelo indisponível com alternativas, custo,
  provedor fora do ar, política de dados) — `tests/design-image-gen.test.ts`,
  `tests/design-ai.test.ts`, `e2e/image-generator.spec.ts`.
- Backup e restauração operacionais (acima).

### 0.3 Problemas encontrados (resumo; detalhes nos itens)

| # | Área | Problema | Item |
| --- | --- | --- | --- |
| 1 | IA | Com OpenAI e demonstração ligados juntos, a escolha automática pode preferir a **demonstração** (capacidade "estruturada" confirmada) a um provedor real (capacidade "não confirmada") em tarefas estruturadas — resposta de exemplo no lugar de IA real. | E0-01 |
| 2 | Busca | A busca global (⌘K) não encontra artes do Estúdio. | E0-02 |
| 3 | Biblioteca | Excluir pasta não pede confirmação. | E0-03 |
| 4 | Tema | "Sistema" não acompanha a troca do sistema operacional sem recarregar. | E0-04 |
| 5 | Assistente IA | A geração de imagem não leva o projeto escolhido (só o cliente); itens estruturados do histórico (sugestão de tarefas) reabrem como JSON cru; o texto gerado não vira demanda com um clique. | E3-01, E3-02, E3-03 |
| 6 | Biblioteca | Cliente/projeto de um arquivo só são definidos no envio. | E0-05 |
| 7 | Projetos | Sem etiquetas, alternar arquivados, ordenação escolhida e grade com miniaturas. | E6-01 |
| 8 | Estúdio | PDF exportado sem texto selecionável; Gemini não gera imagens; importação de JPG/PNG sem prévia antes de criar a arte; sem favoritos de modelos. | E2-05, E2-07, E3-06, E2-04 |
| 9 | Integrações | Instagram (publicação), Google Drive, MCP e migração de arquivos para Blob não existem (sem botões falsos). | E11-* |
| 10 | Comercial | CRM/Vendas não existe. | E10-* |

## 1. Itens por etapa

Legenda das colunas: **Prioridade · Dependências · Arquivos** · critérios de aceitação · testes · estado · conclusão.

### Etapa Zero — Estabilidade e confiabilidade

| ID | Problema → resultado esperado | P · Dep. · Arquivos | Aceitação · Testes | Estado · Conclusão |
| --- | --- | --- | --- | --- |
| E0-01 | Escolha automática prefere a demonstração a um provedor real → com um provedor real compatível, a demonstração nunca é escolhida automaticamente (continua disponível por escolha explícita). | P1 · — · `src/lib/ai-select.ts` | Org com OpenAI + demo: tarefa estruturada escolhe OpenAI; só demo: escolhe demo · `tests/ai-select.test.ts` | Concluído · 24/10/2026 (#25) |
| E0-02 | Artes fora da busca global → ⌘K lista artes (nome), respeitando `designScope`. | P2 · — · `src/server/services/search.ts`, `src/components/shell/command-menu.tsx` | Arte própria aparece; arte de cliente fora do escopo não aparece · `tests/search.test.ts` | Concluído · 24/10/2026 (#25) |
| E0-03 | Excluir pasta sem confirmação → diálogo de confirmação explicando o que acontece com os arquivos. | P2 · — · `src/components/files/folder-tree.tsx` | Confirmar exclui; cancelar não · `e2e/cloud.spec.ts` | Em validação (e2e ampla) |
| E0-04 | Tema "Sistema" não acompanha o SO → ouvinte de `prefers-color-scheme` aplica a troca ao vivo. | P3 · — · `src/components/shell/theme-toggle.tsx` | Trocar o esquema do SO com "Sistema" muda `data-theme` sem recarregar | Concluído · 24/10/2026 (#25) |
| E0-05 | Cliente/projeto do arquivo só no envio → editar vínculos na ficha do arquivo (com validação de escopo). | P3 · — · `services/files.ts`, `components/files/*` | Mudar vínculo reflete em listas e permissões · vitest `files` | Pendente |
| E0-06 | Processamento assíncrono pode falhar sem ninguém ver → painel de saúde (eventos pendentes/falhos, e-mails na fila, automações com erro) em Configurações, com reprocessar seguro. | P2 · E12-02 · `services/events`, `settings/*` | Falha simulada aparece no painel; reprocessar reexecuta uma vez · vitest | Pendente |
| E0-07 | Linha de base de build e e2e ampla desta auditoria. | P0 · — · — | Build concluído; e2e com falhas investigadas e corrigidas ou registradas | Em validação |
| E0-08 | Backup/restauração operacionais. | P0 · — · `scripts/backup-check.ts` | Script conclui OK | Concluído · 24/10/2026 |

### Etapa Um — Experiência visual e navegação

| ID | Problema → resultado esperado | P · Dep. · Arquivos | Aceitação · Testes | Estado |
| --- | --- | --- | --- | --- |
| E1-01 | Estados vazio/carregando/erro desiguais entre módulos → auditoria por tela e padronização com `EmptyState`, `Skeleton` e mensagens de erro acionáveis. | P2 · — · `components/<módulo>` | Lista de telas revisadas; capturas desktop e celular | Pendente |
| E1-02 | Acessibilidade por teclado e leitores de tela → varredura (foco visível, rótulos, `aria-*` em diálogos, gavetas e menus) com correções. | P2 · — · `components/ui`, `shell` | Navegação completa por teclado nas telas principais; sem erros no axe | Pendente |
| E1-03 | Tabelas e quadros em telas estreitas → rolagem própria e colunas prioritárias no celular. | P2 · — · `components/app`, `tasks` | `expectNoHorizontalScroll` em todas as suítes mobile | Em validação (suítes mobile existentes) |
| E1-04 | Cor de destaque personalizável por agência (dentro do preto + dourado). | P3 · — · `globals.css`, settings | Prévia e persistência | Pendente |

### Etapa Dois — Estúdio Criador

| ID | Problema → resultado esperado | P · Dep. · Arquivos | Aceitação · Testes | Estado |
| --- | --- | --- | --- | --- |
| E2-01 | Canvas, zoom, pranchetas, seleção, arrastar, redimensionar, girar, recorte, alinhar, réguas/guias/magnetismo, camadas, grupos, desfazer/refazer, duplicar, atalhos, bloquear/ocultar, autosave, versões (5.1). | P0 · — · `editor/*` | `e2e/editor.spec.ts` (4 cenários × 2 tamanhos) aprovado | Em validação |
| E2-02 | Gerar imagem (5.3) com seletor de modelo também no "Melhorar com IA". | P1 · — · `editor/image-generator.tsx` | #24 + seletor próprio · `tests/design-image-gen.test.ts`, `e2e/image-generator.spec.ts` | Concluído · 24/10/2026 |
| E2-03 | Gerador de carrosséis: "ajustar só o texto" e "só os visuais" de um slide. | P2 · — · `services/carousel-generator.ts`, `editor/carousel-ai.tsx` | Regenerar com `keepImage`/`keepText` separados; prévia antes de aplicar · vitest `carousel-generator` | Pendente |
| E2-04 | Favoritos de modelos (5.6) por pessoa. | P2 · — · migração 0020 `design_favorites`, `services/designs.ts`, `template-gallery.tsx`, `studio/page.tsx` | Favoritar/desfavoritar, favoritos primeiro, filtro "Só favoritos" · `tests/design-favorites.test.ts`, `e2e/template-favorites.spec.ts` | Em validação (e2e) |
| E2-05 | Importar JPG/PNG: prévia das camadas antes de criar a arte (5.5). | P2 · — · `design-import.ts`, `import-template-dialog.tsx` | Prévia com contagem de textos/formas; confirmar cria; cancelar não cria · vitest | Pendente |
| E2-06 | Recursos de design ampliados (5.2): máscaras, mockups, gráficos simples, elementos decorativos. | P3 · — · `lib/design-doc`, `editor/scene.ts` | Cada recurso como objeto do documento com operação e teste de render | Pendente |
| E2-07 | PDF com texto selecionável (5.7). | P3 · — · `lib/design-doc/pdf.ts` | Texto do PDF selecionável; fontes embutidas ou mapeadas · vitest | Pendente |
| E2-08 | Exportação fiel: dimensões, páginas, nomes, transparência (5.7). | P1 · — · `editor/export.ts` | `e2e/editor.spec.ts` "exportar" + conferência de dimensões · vitest `design-ops` | Em validação |

### Etapa Três — IA unificada

| ID | Problema → resultado esperado | P · Dep. · Arquivos | Aceitação · Testes | Estado |
| --- | --- | --- | --- | --- |
| E3-01 | Geração de imagem no Assistente IA não leva o projeto → seletor "Projeto (opcional)" e `projectId` no pedido (arquivo salvo no projeto). | P2 · — · `components/ai/ai-studio.tsx` | Seletor presente; `prepareImage` resolve cliente/projeto · `e2e/ai-studio.spec.ts`, `tests/ai.test.ts` | Em validação (e2e) |
| E3-02 | Histórico reabre sugestão de tarefas como JSON cru → reabrir como lista revisável. | P2 · — · `ai-studio.tsx` | Item estruturado do histórico mostra tarefas, não JSON · `e2e/ai-studio.spec.ts` | Em validação (e2e) |
| E3-03 | Texto do assistente → demanda com um clique (formulário completo pré-preenchido). | P2 · — · `ai-studio.tsx`, `tasks/task-form-dialog.tsx` (`defaultTitle`/`defaultDescription`), `app/w/[org]/ai/page.tsx` | Botão abre o formulário com título e descrição; demanda criada só após confirmar · `e2e/ai-studio.spec.ts` | Em validação (e2e) |
| E3-04 | Prompts favoritos e histórico pesquisável. | P3 · — · schema, `ai-studio.tsx` | Buscar por texto e fixar prompts | Pendente |
| E3-05 | Comparação de versões de resultados de texto. | P3 · — · `ai-studio.tsx` | Duas gerações lado a lado | Pendente |
| E3-06 | Geração de imagens pelo Gemini. | P3 · verificação da API oficial + chave · `server/ai/providers/gemini.ts` | Só com contrato confirmado na documentação | Bloqueado (credencial/documentação) |

### Etapa Quatro — Centro de comando

| ID | Problema → resultado esperado | P · Dep. · Arquivos | Aceitação · Testes | Estado |
| --- | --- | --- | --- | --- |
| E4-01 | Dashboard sem "projetos em risco", carga da equipe e inadimplência → indicadores reais com link para a lista filtrada. | P2 · E9-01 · `services/dashboard.ts`, `app/w/[org]/page.tsx` | "Projetos em risco" já existia; novos: clientes inadimplentes, contratos a vencer, pessoas sobrecarregadas e bloco "Carga da equipe (7 dias)", cada um com link filtrado · `tests/dashboard.test.ts`, `e2e/finance-alerts.spec.ts` | Concluído · 2026-10-24 |
| E4-02 | Recomendações de prioridade por IA separando fato/inferência/sugestão. | P3 · E4-01 · `services/task-ai.ts` | Rótulos distintos; nada é alterado sem confirmação | Pendente |

### Etapa Cinco — Clientes e portal

| ID | Problema → resultado esperado | P · Dep. · Arquivos | Aceitação · Testes | Estado |
| --- | --- | --- | --- | --- |
| E5-01 | Comparação de versões de uma arte no portal (lado a lado). | P2 · — · `portal/*`, `services/approvals.ts` | Cliente vê versão atual × anterior sem dados internos · e2e portal | Pendente |
| E5-02 | Comentários do cliente ancorados na arte (ponto/página). | P3 · E5-01 · `comments.ts` | Comentário aparece na agência com a referência | Pendente |
| E5-03 | Briefings guiados por IA no portal (perguntas em etapas). | P3 · — · `briefings.ts`, portal | Solicitação criada com briefing completo após confirmação | Pendente |

### Etapa Seis — Tarefas, projetos e equipe

| ID | Problema → resultado esperado | P · Dep. · Arquivos | Aceitação · Testes | Estado |
| --- | --- | --- | --- | --- |
| E6-01 | Projetos sem etiquetas, arquivados, ordenação e grade → filtros e visão em grade com miniaturas das artes. | P3 · — · `projects/*` | Alternar arquivados, ordenar, grade · e2e | Pendente |
| E6-02 | Carga de trabalho por pessoa com alerta de sobrecarga na Central (hoje só no calendário e nos relatórios). | P3 · — · `tasks/*` | Indicador por responsável | Pendente |

### Etapa Sete — Chat e notificações

| ID | Problema → resultado esperado | P · Dep. · Arquivos | Aceitação · Testes | Estado |
| --- | --- | --- | --- | --- |
| E7-01 | Validar busca, presença, anexos, menções, reações, janela flutuante e IA do chat na suíte ampla. | P1 · — · — | `e2e/chat*.spec.ts` aprovados | Em validação |
| E7-02 | Decisões do chat → tarefas com prévia (já existe pela IA; conferir no e2e). | P3 · — · `chat-ai.ts` | Cobertura e2e | Pendente |

### Etapa Oito — Conteúdo, tendências e marca

| ID | Problema → resultado esperado | P · Dep. · Arquivos | Aceitação · Testes | Estado |
| --- | --- | --- | --- | --- |
| E8-01 | Validar fontes do Radar de Tendências em produção ("Testar agora"). | P1 · acesso à produção · — | Cada fonte com último sucesso registrado | Bloqueado (produção) |
| E8-02 | Conexão oficial do Instagram no Radar de Marca contra a Meta real. | P1 · `META_APP_ID/SECRET` + análise do app · — | Fluxo OAuth real concluído | Bloqueado (credenciais) |
| E8-03 | Evolução dos diagnósticos (comparar notas entre datas). | P3 · — · `brand-radar.ts` | Gráfico/tabela de evolução · vitest | Pendente |

### Etapa Nove — Financeiro

| ID | Problema → resultado esperado | P · Dep. · Arquivos | Aceitação · Testes | Estado |
| --- | --- | --- | --- | --- |
| E9-01 | Sem inadimplência nem contratos a vencer → indicadores com listas filtradas e alertas (rotina diária). | P2 · — · `services/finance.ts`, `events/schedules.ts`, `events/notifications.ts`, `lib/events.ts`, `finance/page.tsx`, `finance/contracts/page.tsx` | Inadimplência por cliente, contratos a vencer (30/60/90), rotina `cron-contracts-expiring` + evento `contract.expiring` + notificação a quem tem `finance.write` · `tests/finance.test.ts`, `e2e/finance-alerts.spec.ts` | Concluído · 2026-10-24 |
| E9-02 | Previsão de receitas/despesas (contratos recorrentes + faturas emitidas + despesas pendentes). | P3 · E9-01 · `finance.ts` | Projeção de 3 meses com dados reais · vitest | Pendente |
| E9-03 | Horas previstas × realizadas por projeto. | P3 · — · `finance.ts`, `reports.ts` | Coluna na rentabilidade · vitest | Pendente |

### Etapa Dez — CRM

| ID | Problema → resultado esperado | P · Dep. · Arquivos | Aceitação · Testes | Estado |
| --- | --- | --- | --- | --- |
| E10-01 | Modelo de dados: leads/empresas/contatos, pipeline com etapas configuráveis, interações, lembretes (migração aditiva + RLS + permissões `crm.*`). | P2 · — · schema, migração, `permissions.ts` | Migração aplica; RLS forçado; papéis padrão atualizados · vitest isolamento | Pendente |
| E10-02 | Telas: pipeline (quadro), lista, ficha do lead, próximos contatos, propostas. | P2 · E10-01 · `components/crm/*`, `app/w/[org]/crm` | e2e desktop + celular | Pendente |
| E10-03 | Conversão de oportunidade em cliente/projeto/contrato sem duplicar clientes (busca por nome/documento/e-mail). | P2 · E10-02 · `services/crm.ts` | Conversão cria vínculos e histórico · vitest | Pendente |
| E10-04 | Relatórios de conversão. | P3 · E10-03 · `reports.ts` | Funil por etapa e período | Pendente |

### Etapa Onze — Integrações externas

| ID | Problema → resultado esperado | P · Dep. · Arquivos | Aceitação · Testes | Estado |
| --- | --- | --- | --- | --- |
| E11-01 | Publicação no Instagram pela API oficial da Meta. | P2 · app Meta aprovado (`instagram_content_publish`) · novo serviço | Publicação real registrada; revogação tratada | Bloqueado (credenciais/análise do app) |
| E11-02 | Google Drive (importar/exportar arquivos). | P3 · credenciais OAuth Google · novo serviço | Listar e importar com permissão; revogar | Bloqueado (credenciais) |
| E11-03 | MCP para assistentes autorizados (leitura de dados com as permissões do usuário). | P3 · decisão de produto (escopo) · rota + tokens | Token por pessoa, revogável, auditado | Pendente |
| E11-04 | Busca global ampliada (conversas, aprovações, conteúdos). | P3 · E0-02 · `search.ts` | Resultados respeitam permissões · vitest | Pendente |
| E11-05 | Migração opcional de arquivos do banco para o Blob/S3. | P3 · token em produção · `storage/*`, script | Script idempotente com conferência · vitest | Bloqueado (configuração) |

### Etapa Doze — Automações

| ID | Problema → resultado esperado | P · Dep. · Arquivos | Aceitação · Testes | Estado |
| --- | --- | --- | --- | --- |
| E12-01 | Modelos extras: onboarding de cliente, entrega de arquivos, acompanhamento financeiro, relatórios periódicos. | P3 · E9-01 · `automation-presets.ts` | Modelos aplicáveis e testados · vitest `automations` | Pendente |
| E12-02 | Pré-visualizar ações e reprocessar execuções falhas (seguras). | P2 · — · `automation-engine.ts`, telas | Prévia lista efeitos; reprocessar não duplica · vitest | Pendente |

### Etapa Treze — Busca, desempenho e mobile

| ID | Problema → resultado esperado | P · Dep. · Arquivos | Aceitação · Testes | Estado |
| --- | --- | --- | --- | --- |
| E13-01 | Medir tempos das telas principais e consultas N+1; paginação onde faltar. | P3 · — · serviços de listagem | Medições registradas; consultas revisadas | Pendente |
| E13-02 | Miniaturas da Biblioteca com carregamento progressivo e tamanhos corretos. | P3 · — · `files/*` | Sem imagens cheias em grades | Pendente |

### Etapa Quatorze — Segurança e qualidade (regras permanentes)

- Nenhuma correção sem teste de regressão; nenhum teste removido para ficar verde.
- RLS, escopos, validação Zod, auditoria, URLs assinadas, limites de IA e proteção de webhooks não mudam para facilitar testes.
- Migrações só aditivas e versionadas; backup antes de migração que altere dados.

### Etapa Quinze — Documentação (regras permanentes)

- Cada ciclo atualiza este roadmap, o changelog (quando houver entrega testada), `.env.example` e o guia do módulo.
- Nada planejado é registrado como implementado.

## 2. Ciclos executados

| Ciclo | Itens | Alterado | Testes executados | Falta | Pendentes no roadmap |
| --- | --- | --- | --- | --- | --- |
| 0 | Auditoria, linha de base, roadmap | este documento | typecheck, lint, vitest (504), backup-check, build | e2e ampla (em execução) | ver resumo |
| 1 | E0-01, E0-02, E0-03, E0-04 (#25) | `lib/ai-select.ts`, `services/search.ts`, `shell/command-menu.tsx`, `files/folder-tree.tsx`, `shell/theme-toggle.tsx` | typecheck 0, lint 0, vitest completo 61 arquivos / 509 testes | e2e `cloud` da suíte ampla (confirma a exclusão de pasta) | 37 pendentes, 6 bloqueados |
| 2 | E3-01, E3-02, E3-03 (#26) | `ai/ai-studio.tsx`, `tasks/task-form-dialog.tsx`, `app/w/[org]/ai/page.tsx` | typecheck 0, lint 0 | e2e `ai-studio.spec.ts` (em execução após a suíte ampla) | 34 pendentes |
| 4 | E9-01, E4-01 (#28) | `services/finance.ts`, `services/dashboard.ts`, `events/schedules.ts`, `events/notifications.ts`, `lib/events.ts`, `lib/notification-prefs.ts`, `finance/page.tsx`, `finance/contracts/page.tsx`, `app/w/[org]/page.tsx` | typecheck 0, lint 0, vitest `finance` + `dashboard` + `notifications` + `automations` (33 testes), e2e `finance-alerts` ✓ (desktop e celular) | — | 31 pendentes |
| 3 | E2-04 (#27) | migração 0020, `services/designs.ts`, `actions/designs.ts`, `template-gallery.tsx`, `studio/page.tsx` | typecheck 0, lint 0, vitest `design-favorites` + `design-server` + `template-library` (16 testes) | e2e `template-favorites.spec.ts` | 33 pendentes |

## 3. Resumo de pendências

Atualizado ao fim de cada ciclo.

| Estado | Itens |
| --- | --- |
| Concluído | E0-01, E0-02, E0-04, E0-08, E2-02, E4-01, E9-01 |
| Em validação | E0-03, E0-07, E1-03, E2-01, E2-04, E2-08, E3-01, E3-02, E3-03, E7-01 |
| Bloqueado | E3-06, E8-01, E8-02, E11-01, E11-02, E11-05 |
| Pendente | E0-05, E0-06, E1-01, E1-02, E1-04, E2-03, E2-05, E2-06, E2-07, E3-04, E3-05, E4-02, E5-01, E5-02, E5-03, E6-01, E6-02, E7-02, E8-03, E9-02, E9-03, E10-01, E10-02, E10-03, E10-04, E11-03, E11-04, E12-01, E12-02, E13-01, E13-02 |

Próxima ação exata: fechar as validações e2e dos ciclos 1–3 (`cloud`, `ai-studio`, `template-favorites`), investigar as falhas da suíte ampla (`chat-dock` desktop, `cloud` desktop — classificar regressão × instabilidade) e seguir para E9-01 (inadimplência e contratos a vencer) e E4-01 (centro de comando).
