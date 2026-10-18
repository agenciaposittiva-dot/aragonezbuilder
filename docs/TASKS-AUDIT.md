# Central de Tarefas — auditoria técnica e plano

Etapa 1 da reformulação (antes de qualquer alteração). Objetivo: evoluir o
módulo atual com segurança, preservando dados e integrações.

## O que existe hoje (funciona e é reaproveitado)

| Área | Implementação |
|---|---|
| Dados | `tasks` (projeto obrigatório, cliente pelo projeto, etapa, solicitação de origem, status do fluxo, prioridade baixa/média/alta/urgente, responsável, início, prazo, estimativa, posição, conclusão, arquivamento, criador), `task_collaborators`, `task_checklist_items`, `task_dependencies`, `time_entries`, subtarefas por `parent_task_id`. Tudo com `organization_id` e RLS. |
| Fluxo | Status configuráveis por organização (`workflow_statuses`/`workflow_transitions`); padrão: Backlog, A fazer, Em produção, Revisão interna, Com o cliente, Ajustes, Concluída, Cancelada — cobre as colunas pedidas (inclusive “Aguardando cliente”). |
| Serviços | `src/server/services/tasks.ts`: listagem com filtros no servidor (texto, projeto, cliente, responsável/eu/sem responsável, status, prioridade, intervalo de prazo, arquivadas, subtarefas) e paginação; criação, edição parcial, mudança de status com transições, concluir/reabrir, mover no quadro (posição), arquivar, excluir, colaboradores, checklist (ordenável), dependências (com bloqueio de ciclo), histórico auditável. Permissões `tasks.read/write/assign/delete` + escopo por cliente/projeto. |
| Telas | `/w/[org]/tasks` com Lista, Quadro (arrastar e soltar com @dnd-kit) e Calendário mensal; filtros por URL; “Minhas tarefas”; criação rápida (`quick-add-task`) e formulário completo; página de detalhes (`/w/[org]/tasks/[id]`) com título, descrição em Markdown, propriedades, checklist, subtarefas, dependências, tempo, anexos, comentários internos e histórico. |
| Integrações | Projetos (lista/quadro por projeto), solicitações (conversão em projeto/tarefas), aprovações (pedido ligado à tarefa; ajustes reabrem a tarefa), arquivos (anexos), IA (tarefas sugeridas a partir de briefing com confirmação), notificações (atribuição, mudança de status, atraso) e automações (motor de regras por evento). Clientes nunca veem tarefas (teste existente). |

## Problemas e lacunas encontrados

- Detalhes abrem em outra página (perde o contexto da lista/quadro); não há painel lateral.
- Não há visões “Minha visão” (vencidas, hoje, próximos prazos, concluídas recentemente), “Prioridades” nem Linha do tempo de tarefas; calendário só mensal.
- Lista sem agrupamento, ordenação escolhida pelo usuário, colunas configuráveis e edição em linha.
- Sem etiquetas (labels), sem modelos de tarefa/processo e sem indicadores de produtividade no topo.
- Bloqueios por dependência existem, mas não aparecem como estado visível nas listas/quadro.
- Comentários de tarefa não têm menções; não há aviso de alteração de prazo; preferências de notificação chegam com o módulo do portal (tabela `notification_preferences`).
- Atualização otimista só no quadro; demais ações recarregam a página inteira.
- Em telas pequenas, o quadro fica apertado (colunas de largura fixa) e os filtros quebram em muitas linhas.

## Plano (incremental, sem recriar o que funciona)

1. **Estrutura**: cabeçalho com indicadores reais (minhas abertas, vencidas, para hoje, concluídas na semana), busca, filtros rápidos e avançados, abas de visualização. Mantém os filtros na URL e os serviços atuais.
2. **Lista e Quadro**: agrupamento (status, projeto, cliente, responsável, prioridade, prazo), ordenação, colunas escolhidas pelo usuário (preferência local), edição em linha de status/prioridade/responsável/prazo, indicador de bloqueio e de atraso, progresso de subtarefas/checklist; quadro responsivo com rolagem horizontal própria.
3. **Painel lateral de detalhes**: abre sobre a visão atual (rota interceptada/parâmetro), com todas as seções da página atual; a página dedicada continua existindo para links diretos.
4. **Subtarefas, comentários e histórico**: subtarefas com responsável/status/prazo editáveis em linha; menções em comentários (com notificação); separação clara entre comentário interno e mensagem ao cliente (tarefas continuam só internas).
5. **Calendário e filtros avançados**: dia/semana/mês, arrastar para mudar prazo (com permissão), sobrecarga por pessoa; filtros salvos por usuário.
6. **IA**: assistente com o seletor universal de IA (módulo em andamento) — criar tarefas a partir de texto, dividir em etapas, sugerir prazos/prioridades, resumir comentários, apontar tarefas sem responsável/prazo e bloqueios; sempre com prévia e confirmação antes de gravar em massa.
7. **Integrações**: tarefas a partir de solicitações do portal, ligação com aprovações/etapas, editor de artes e calendário editorial (quando existir).
8. **Automações e notificações**: regras de tarefa no motor existente (atribuir padrão, notificar revisor, prazo próximo, liberar dependente), com histórico e proteção contra ciclos (o motor já limita profundidade).
9. **Testes e documentação** a cada etapa.

### Mudanças de esquema previstas (migração própria, depois da 0005 do seletor de IA)

- `task_labels` (etiquetas por organização, cor) e `task_label_links`.
- `task_templates` + itens (subtarefas/checklist com deslocamento de prazo) para processos recorrentes.
- Nenhuma alteração destrutiva: colunas e tabelas novas apenas.

## Situação após as etapas 4 a 10

| Plano | Situação | Onde |
|---|---|---|
| 4. Subtarefas, comentários e histórico | Subtarefas com status, responsável e prazo editáveis em linha; menções com `@` nos comentários de tarefa (só pessoas com acesso à tarefa; a notificação respeita as preferências, categoria “comentários”); aviso de prazo alterado (`task.due_changed`); comentários da tarefa identificados como internos; duplicar (com ou sem subtarefas). | `task-subtasks.tsx`, `comments.tsx`, `services/comments.ts`, `events/notifications.ts` |
| Exclusão | **Decisão:** “Excluir tarefa” passa a mover para a **Lixeira** (com as subtarefas, mesma data), com desfazer e restauração; a exclusão definitiva acontece na Lixeira ou na limpeza automática (`hardDeleteTask`). Tarefas na lixeira somem de listas, indicadores, calendário e buscas (escopo `taskScope`). | `services/tasks.ts`, `services/trash.ts` |
| 5. Calendário e filtros | Calendário dia/semana/mês; arrastar para mudar o prazo (só com `tasks.write`, otimista, desfeito se o servidor recusar); bandeja “Sem prazo”; aviso de sobrecarga (3+ entregas da mesma pessoa no dia). Filtros salvos por pessoa (só parâmetros conhecidos e válidos, até 30). Etiquetas por organização com cor (renomear/excluir: `org.manage`). Modelos de tarefa com etapas, checklists e prazos relativos; aplicar a um projeto; “Salvar como modelo”. | `task-calendar.tsx`, `saved-views.tsx`, `task-labels.tsx`, `task-templates.tsx`, `/w/[org]/task-templates` |
| 6. IA | Assistente na Central (texto → tarefas, solicitação → tarefas, pendências) e na tarefa (quebrar em subtarefas/checklist, sugerir prioridade e prazo, resumir comentários), com o seletor universal (módulo “Tarefas”; tarefas `task_planning` e `task_review` no catálogo). Sempre prévia editável + confirmação; criação numa transação. Datas: só as citadas no texto (ou o prazo desejado da solicitação) vêm marcadas; as demais aparecem como “Sugestão da IA — não é prazo combinado”, desmarcadas. Política: sem “contexto dos clientes”, só o texto digitado vai ao provedor; dados de tarefas, comentários e solicitações exigem a autorização (ou o modo demonstração, local). Pendências (sem responsável, sem prazo, bloqueadas com o motivo) são calculadas sem IA. | `lib/task-ai.ts`, `services/task-ai.ts`, `api/tasks/ai`, `task-ai.tsx`, `ai/demo-tasks.ts` |
| 7. Integrações | Solicitação → tarefas pelo assistente (vincula `request_id` e coloca a solicitação em produção no projeto escolhido; projeto de outro cliente é recusado); atalho “Planejar tarefas com IA” na solicitação. Pedido de aprovação pode ser vinculado a uma tarefa do projeto do arquivo e, se marcado, leva a tarefa para Revisão interna / Aprovação do cliente. | `services/approvals.ts`, `request-approval-dialog.tsx`, `requests/[id]` |
| 8. Automações | Nova ação “Atribuir responsável” (por padrão só sem responsável). Eventos `task.due_soon` (rotina diária `cron-task-due-soon`, de hoje a 2 dias, um aviso por tarefa **e prazo**) e `task.unblocked` (todas as dependências concluídas), com notificação ao responsável e disponíveis como gatilho. Concluir uma tarefa libera as dependentes também quando a conclusão vem de automação; automação não conclui tarefa com dependências abertas (falha registrada). Modelos prontos: responsável padrão, aviso ao revisor, aprovação do cliente conclui a tarefa, prazo próximo ao responsável do projeto e liberar a próxima tarefa. Histórico (`automation_runs`) e proteção contra ciclos (eventos de automação marcados com `viaAutomation` não disparam regras) já existiam e foram mantidos. | `automation-engine.ts`, `schedules.ts`, `task-release.ts`, `automation-presets.ts` |

### Esquema (somente adições)

- `tasks.deleted_at`, `tasks.deleted_by_user_id` (+ índice parcial `tasks_trash_idx`) e `comments.mentioned_membership_ids uuid[] default '{}'`.
- Tabelas `task_labels` (nome único por organização, sem diferenciar maiúsculas), `task_label_links`, `task_saved_views`, `task_templates` e `task_template_steps`. Todas têm `organization_id`: o `scripts/migrate.ts` aplica a RLS automaticamente (`app_apply_tenant_rls()`).
- A migração **não está versionada nesta branch**: gere com `npm run db:generate` ao integrar (depois das migrações já existentes). Nenhuma permissão nova foi criada, então não há concessão manual a papéis existentes.

### Testes

- Vitest: `tests/tasks-collab.test.ts`, `tests/tasks-organize.test.ts`, `tests/tasks-ai.test.ts` (provedor de demonstração e Anthropic simulado por `tests/ai-mocks.ts`) e `tests/tasks-automation.test.ts`.
- Playwright (computador e celular 390 px): `e2e/tasks.spec.ts` — criação rápida, edição inline, arrastar no quadro, mudar prazo no calendário, subtarefas, menção, etiqueta, modelo, assistente de IA com confirmação (modo demonstração habilitado pela organização e restaurado no fim) e lixeira.

### Pendências conhecidas

- Editor de artes e calendário editorial: a ligação com tarefas fica para quando esses módulos estabilizarem (outras frentes de trabalho).
- “Revisor” é o responsável pelo projeto (aviso padrão) ou quem a regra de automação indicar; não há campo de revisor por tarefa.
- A janela do aviso de prazo próximo é fixa (2 dias); as regras podem filtrar por `daysLeft`.
- O modo demonstração da IA só divide o texto em linhas/frases e reconhece datas `dd/mm`, `@nome` e “urgente”; respostas reais dependem de um provedor configurado.
