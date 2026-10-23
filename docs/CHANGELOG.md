# Registro de atualizações

Espelho de `src/lib/changelog.ts`, exibido na página **Atualizações** (`/w/[org]/updates`).
Só entram mudanças implementadas **e** testadas; cada item lista os testes executados.
Publicação em produção depende da implantação de cada ambiente.

`tests/changelog.test.ts` confere que os dois registros estão iguais e que os testes citados existem.

## #19 — Chat flutuante em qualquer módulo e avisos de eventos

- **Data:** 2026-10-23
- **Módulo:** Chat da Equipe
- **Status:** Implementado em parte
- **Descrição:** Botão do chat no cabeçalho (e no editor do Estúdio Criador) abre o Chat da Equipe numa janela flutuante sobre a página atual, com minimizar, restaurar, fechar e abrir em tela cheia; a conversa e o rascunho continuam ao navegar entre módulos. Clicar num aviso de mensagem abre a conversa na janela, sem sair da página. Avisos de eventos da plataforma (comentários, tarefas, aprovações, solicitações) aparecem como janelas no canto superior direito, com título, prévia, hora, abrir e dispensar. No celular, a janela do chat ocupa a tela.
- **Problema resolvido:** Para responder uma mensagem era preciso sair da tela em que se estava trabalhando; os avisos do sino só apareciam ao abrir o sino.
- **Testes executados:**
  - e2e/chat-dock.spec.ts — abrir/minimizar/restaurar/fechar, mensagem real, navegação, aviso abre a conversa, editor com canvas à vista, login sem chat, aviso de evento abre a demanda (desktop e celular)
  - e2e/chat-notifications.spec.ts — janela flutuante, som, agrupamento e reconexão
  - e2e/chat.spec.ts — conversa em tempo real e clientes sem acesso
- **Observações:** Verificado no navegador (desktop, celular e editor); a suíte e2e completa deste item está em execução e o status passa a “testado” quando ela terminar. O chat continua usando a consulta periódica ao servidor (4 a 8 s com a aba visível) — não há WebSocket na hospedagem serverless. As mensagens ficam só no banco; a janela guarda apenas se estava aberta e qual conversa. Avisos de eventos não tocam som.

## #18 — Editor: aparência escura, zoom no cabeçalho e faixa de slides

- **Data:** 2026-10-23
- **Módulo:** Estúdio Criador
- **Status:** Implementado e testado
- **Descrição:** O editor abre com aparência escura (troca em “Mais ações” → Aparência do editor) e devolve o tema do aplicativo ao sair. Botões − / + de zoom ao lado da porcentagem. No carrossel, cada prancheta mostra “Slide N”, o slide ativo tem “Duplicar” e uma prancheta tracejada “+” depois do último slide adiciona um novo.
- **Problema resolvido:** Zoom só pelo menu ou atalho; para adicionar ou duplicar slides era preciso ir ao painel de páginas.
- **Testes executados:**
  - e2e/studio-home.spec.ts — zoom, tema e faixa de slides
  - e2e/editor.spec.ts — editor completo
- **Observações:** Os menus e caixas de diálogo abertos no editor seguem a mesma aparência.

## #17 — Estúdio Criador: nova entrada com IA, formatos e galeria de modelos

- **Data:** 2026-10-23
- **Módulo:** Estúdio Criador
- **Status:** Implementado e testado
- **Descrição:** O Estúdio de Carrosséis passa a se chamar Estúdio Criador (menu, títulos, dashboard, guia). A página inicial ganha o destaque “Criar posts com IA” (abre o gerador real), os cartões “Novo vertical” (9:16) e “Novo post” (4:5, com opção de carrossel e quantidade de slides) e a seção “Comece com um modelo”, com os modelos da agência por categoria. A aba Modelos lista tudo com busca, filtros de categoria e formato, prévia com dados do modelo, “Usar modelo”, troca de categoria e carregamento progressivo.
- **Problema resolvido:** A entrada do Estúdio era uma lista plana de artes; os modelos ficavam escondidos na aba Templates, sem categorias, prévia nem formato visível.
- **Testes executados:**
  - tests/template-categories.test.ts — 4 testes (categorias, legado, formatos)
  - e2e/studio-home.spec.ts — início, prévia, filtros e criação rápida (desktop e celular)
  - e2e/template-library.spec.ts, e2e/editor.spec.ts e e2e/carousel-generator.spec.ts — fluxos existentes
- **Observações:** Rotas (/studio) e registros (designs/templates) não mudaram; projetos salvos abrem como antes.

## #16 — Me guie: primeiros passos, dicas da tela e tour

- **Data:** 2026-10-22
- **Módulo:** Navegação
- **Status:** Implementado e testado
- **Descrição:** Botão “Me guie” no cabeçalho abre um painel com os primeiros passos da agência (calculados com os dados reais e só os que a pessoa pode fazer), progresso, “Ir agora”, dicas da tela atual, tour rápido com “Refazer o tour” e “Esconder o botão” (volta pelo menu do perfil).
- **Problema resolvido:** Quem chegava à plataforma não tinha um roteiro do que configurar nem dicas de cada tela.
- **Testes executados:**
  - tests/guide.test.ts — 3 testes (passos pelo banco e por permissão)
  - e2e/guide.spec.ts — desktop e celular
- **Observações:** A preferência de esconder o botão e a posição do tour ficam no aparelho de quem vê; os passos vêm sempre do servidor.

## #15 — Lembretes de prazo sem empilhar

- **Data:** 2026-10-22
- **Módulo:** Notificações
- **Status:** Implementado e testado
- **Descrição:** Avisos repetidos de tarefa atrasada, prazo próximo e lembrete de aprovação substituem o aviso anterior ainda não lido do mesmo item. O aviso de atraso agora traz o nome da tarefa e a data do prazo, e abre a tarefa.
- **Problema resolvido:** Uma tarefa atrasada gerava um novo “Tarefa atrasada” por dia, sem o nome da tarefa no título, enchendo a lista de notificações.
- **Testes executados:**
  - tests/tasks-automation.test.ts — um aviso não lido por tarefa, link correto e tarefa na lixeira sem aviso
- **Observações:** Depois de lido, o lembrete seguinte chega como novo; o lido continua no histórico.

## #14 — Referências por link

- **Data:** 2026-10-22
- **Módulo:** Biblioteca
- **Status:** Implementado e testado
- **Descrição:** Aba Referências na Biblioteca: salve links de YouTube, Instagram, Pinterest, TikTok, Behance ou qualquer página, com etiquetas, cliente e observação. Busca e filtros por origem e cliente.
- **Problema resolvido:** Inspirações ficavam espalhadas em conversas e favoritos pessoais.
- **Testes executados:**
  - tests/routines-references.test.ts — escopo por cliente
  - e2e/routines-references.spec.ts
- **Observações:** O servidor não acessa os links salvos; só o YouTube tem miniatura.

## #13 — Rotina: tarefas recorrentes

- **Data:** 2026-10-22
- **Módulo:** Rotina
- **Status:** Implementado e testado
- **Descrição:** Tarefas diárias, semanais ou mensais criadas automaticamente no projeto escolhido, com responsável, prioridade e prazo. Prévia das próximas datas, pausar, retomar e excluir (as tarefas criadas continuam).
- **Problema resolvido:** Tarefas repetitivas (relatórios, organização, escala de stories) dependiam de lembrança.
- **Testes executados:**
  - tests/recurrence.test.ts — 5 testes (datas)
  - tests/routines-references.test.ts — geração sem duplicar
  - e2e/routines-references.spec.ts — desktop e celular
- **Observações:** Uma tarefa por data, garantida por índice único no banco.

## #12 — Criar demanda a partir de um dia

- **Data:** 2026-10-22
- **Módulo:** Calendário
- **Status:** Implementado e testado
- **Descrição:** Calendário próprio no menu (mês, semana e dia), com “+” em cada dia e “Nova demanda neste dia”. Arrastar muda o prazo do mesmo registro.
- **Problema resolvido:** Para agendar era preciso criar a tarefa em outra tela e digitar a data.
- **Testes executados:**
  - e2e/demands.spec.ts — criar pelo calendário
  - e2e/tasks.spec.ts — 7 testes

## #11 — Dashboard com dados reais

- **Data:** 2026-10-22
- **Módulo:** Dashboard
- **Status:** Implementado e testado
- **Descrição:** Boas-vindas, atalhos, indicadores de demandas, Estúdio com miniaturas reais, uso de IA no mês, projetos recentes (grade ou lista), agenda de prazos, aprovações e atividade.
- **Problema resolvido:** O painel inicial não mostrava o trabalho recente nem atalhos para as ferramentas.
- **Testes executados:**
  - tests/dashboard.test.ts — 3 testes

## #10 — Artes ligadas à demanda e ao projeto

- **Data:** 2026-10-22
- **Módulo:** Demandas e Estúdio
- **Status:** Implementado e testado
- **Descrição:** A demanda mostra “Artes da demanda” com miniaturas e cria uma arte ou carrossel já vinculado. O projeto ganhou a aba Artes. São os mesmos registros do Estúdio, sem cópia.
- **Problema resolvido:** Arte e demanda viviam separadas; era preciso procurar a peça no Estúdio.
- **Testes executados:**
  - tests/design-links.test.ts — 2 testes (vínculo e permissão)

## #9 — Aprovação por link, sem conta

- **Data:** 2026-10-22
- **Módulo:** Aprovações
- **Status:** Implementado e testado
- **Descrição:** Gere um link com validade para o cliente aprovar ou pedir ajustes nas peças pendentes sem criar conta. O link mostra só a versão atual de cada peça, registra o nome de quem decidiu, pode ser revogado e tem limite de tentativas.
- **Problema resolvido:** Clientes sem acesso ao portal não conseguiam aprovar pela plataforma.
- **Testes executados:**
  - tests/approval-links.test.ts — 6 testes
  - e2e/approval-link.spec.ts
- **Observações:** O token fica guardado como hash no banco; o link completo aparece uma única vez.

## #8 — Página de demandas do cliente

- **Data:** 2026-10-22
- **Módulo:** Portal do cliente
- **Status:** Implementado e testado
- **Descrição:** No portal, o cliente vê só as próprias demandas, com indicadores (Em aberto, Em produção, Aguardando sua aprovação, Entregues) e “Nova demanda”. Outros clientes nunca aparecem.
- **Problema resolvido:** O cliente não tinha uma visão única das demandas dele.
- **Testes executados:**
  - e2e/portal.spec.ts
  - tests/requests.test.ts e tests/portal.test.ts — cliente só vê e abre o que é dele

## #7 — Login do portal com a marca do cliente

- **Data:** 2026-10-22
- **Módulo:** Portal do cliente
- **Status:** Implementado e testado
- **Descrição:** Novo layout em cartão: logo do cliente, cartão escuro “Bem-vindo”, campos com ícones, mostrar/ocultar senha, “Mantenha-me conectado”, “Esqueceu a senha?”, botão na cor da marca, link de Política de Privacidade e arte lateral.
- **Problema resolvido:** A tela de entrada do portal não seguia a identidade de cada cliente.
- **Testes executados:**
  - tests/portal-login.test.ts — 4 testes
  - e2e/portal.spec.ts e e2e/portal-acceptance.spec.ts

## #6 — Minhas demandas

- **Data:** 2026-10-22
- **Módulo:** Minhas demandas
- **Status:** Implementado e testado
- **Descrição:** Saudação, busca, “Ver como” (para quem pode atribuir), nova demanda pelo modal, indicadores clicáveis (Atrasadas, Para hoje, Próximos 7 dias, Todas abertas) sem contagem dupla, visões Lista e Minha semana (arrastar muda o prazo) e agrupamento por etapa ou por prazo.
- **Problema resolvido:** Cada pessoa precisava filtrar a lista geral de tarefas para ver o próprio trabalho.
- **Testes executados:**
  - tests/demands.test.ts — 4 testes (indicadores e permissão)
  - e2e/demands.spec.ts — indicadores, modal e semana

## #5 — Categorias de clientes configuráveis

- **Data:** 2026-10-22
- **Módulo:** Clientes
- **Status:** Implementado e testado
- **Descrição:** Categorias com cor, contagem, ordem e expandir/recolher no menu e na lista de clientes. Criar, renomear, reordenar e excluir (os clientes voltam para “Sem categoria”). Mover um cliente nunca duplica o registro.
- **Problema resolvido:** Não havia como organizar a carteira (ativos, avulsos, ex-clientes).
- **Testes executados:**
  - tests/client-categories.test.ts — 6 testes (escopo, contagem, exclusão sem perder cliente)
  - e2e/demands.spec.ts — criar, mover e excluir categoria pelo menu
- **Observações:** Migração aditiva 0016 cria três categorias padrão em cada organização.

## #4 — Menu lateral profissional

- **Data:** 2026-10-22
- **Módulo:** Navegação
- **Status:** Implementado e testado
- **Descrição:** Cabeçalho com logo e nome da plataforma, troca de organização, botão de recolher com dicas quando recolhido, contadores reais e nova ordem: Minhas demandas, Dashboard, Clientes, Biblioteca, Estúdio Criador, Criação com IA, Calendário, Redes sociais, Financeiro, Relatórios e Lixeira.
- **Problema resolvido:** O menu não tinha identidade nem atalhos para o trabalho do dia; itens importantes ficavam escondidos.
- **Testes executados:**
  - e2e/demands.spec.ts
  - e2e/brand-radar.spec.ts e e2e/design-ai.spec.ts (títulos atualizados)
- **Observações:** Vendas/CRM não foi incluído porque ainda não existe — nenhum item do menu leva a uma tela vazia.

## #3 — Importação de modelo por imagem com erros claros

- **Data:** 2026-10-22
- **Módulo:** Estúdio Criador
- **Status:** Implementado e testado
- **Descrição:** Importar modelo aceita JPG, PNG e WebP. Imagens grandes são reduzidas e recomprimidas no navegador antes do envio, com aviso do que foi feito. Formato inválido, arquivo vazio, imagem corrompida ou grande demais geram mensagem específica.
- **Problema resolvido:** Falhas na importação de JPG apareciam como erro genérico (ou resposta não-JSON do servidor) sem dizer o motivo. Nenhuma mensagem pede para excluir projetos.
- **Testes executados:**
  - e2e/carousel-generator.spec.ts — importação de modelo com aviso

## #2 — Miniaturas reais das páginas

- **Data:** 2026-10-22
- **Módulo:** Estúdio Criador
- **Status:** Implementado e testado
- **Descrição:** A lista de páginas do carrossel mostra a miniatura de cada página, nome em duas linhas e ações sobre a miniatura (sempre visíveis em telas de toque).
- **Problema resolvido:** Os nomes das páginas eram espremidos pelos botões e não havia prévia do conteúdo.
- **Testes executados:**
  - e2e/editor.spec.ts
- **Observações:** As miniaturas são atualizadas só para a página alterada e as vizinhas do carrossel, para não pesar.

## #1 — Canvas sempre visível no editor

- **Data:** 2026-10-22
- **Módulo:** Estúdio Criador
- **Status:** Implementado e testado
- **Descrição:** Painel lateral e painel de propriedades podem ser recolhidos (a preferência fica no aparelho). Com o assistente de IA aberto em telas menores, o painel lateral recolhe sozinho. Ao redimensionar, a visualização continua centralizada.
- **Problema resolvido:** Em 1024 px com o assistente de IA aberto, o canvas ficava com cerca de 380 px de largura. Agora fica com 636 px; em 1280 px, com os dois painéis recolhidos, 1232 px.
- **Testes executados:**
  - e2e/editor.spec.ts — editor completo (desktop)
  - Capturas em 1024, 1280 e 1440 px para medir o canvas
