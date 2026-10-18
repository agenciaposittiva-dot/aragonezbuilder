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
