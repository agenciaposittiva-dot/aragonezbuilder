# Registro de atualizações

Espelho de `src/lib/changelog.ts`, exibido na página **Atualizações** (`/w/[org]/updates`).
Só entram mudanças implementadas **e** testadas; cada item lista os testes executados.
Publicação em produção depende da implantação de cada ambiente.

`tests/changelog.test.ts` confere que os dois registros estão iguais e que os testes citados existem.

## #31 — Google Drive por pessoa: conectar, exportar do Estúdio, importar e organizar

- **Data:** 2026-10-24
- **Módulo:** Arquivos e integrações
- **Status:** Implementado e testado
- **Descrição:** Nova seção Meu perfil → "Armazenamento e integrações" com o Google Drive: cada pessoa conecta a própria conta pelo OAuth 2.0 oficial (estado assinado contra CSRF, tokens criptografados no servidor, nunca no navegador), vê o estado da conexão e a conta, testa o acesso, renova a autorização quando o Google pede e desconecta com confirmação (revogando o token). Escopo restrito por padrão (só arquivos e pastas criados pela plataforma; escopo amplo opcional por configuração). Preferências: destino dos novos arquivos (plataforma ou plataforma + cópia no Drive), organização automática das pastas (cliente, projeto, ano) e pasta padrão, com criação da pasta "Aragonez Builder". Na biblioteca, a aba Google Drive navega nas pastas autorizadas, busca por nome, cria pastas e importa arquivos para um cliente/projeto (origem "Google Drive" registrada). As ações de um arquivo ganharam "Salvar no Google Drive" e o Exportar do Estúdio ganhou "Enviar para Arquivos e Google Drive" (PNG/JPG/PDF), com link do arquivo no final. Nada é migrado automaticamente nem compartilhado. Migração aditiva 0022 (google_drive_connections, google_drive_files, origem "drive"). A validação real depende de GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET (passo a passo em docs/GOOGLE-DRIVE.md).
- **Problema resolvido:** Não havia como usar o Drive da própria pessoa: as exportações ficavam só na plataforma e importar do Drive exigia baixar e subir manualmente.
- **Testes executados:**
  - tests/google-drive.test.ts — estado assinado, URL de autorização (escopo restrito, redirecionamento, estado), conexão com tokens criptografados e conta confirmada (sem escopo nada é salvo), isolamento entre pessoas e organizações, testar acesso e autorização necessária, renovação de token, exportar com pastas cliente/projeto e elo com a versão, importar com validações e origem drive, navegar/buscar/criar pasta/pasta padrão, falhas (quota, limite, indisponível, rede), desconectar com revogação
  - e2e/google-drive.spec.ts — página pelo perfil, estado do Google Drive (configurado ou não) e aba na biblioteca (desktop e celular)

## #30 — Minhas inteligências artificiais: chaves de IA próprias por pessoa (BYOK)

- **Data:** 2026-10-24
- **Módulo:** Inteligência artificial
- **Status:** Implementado e testado
- **Descrição:** Cada pessoa pode conectar as próprias chaves de IA (Anthropic, OpenAI, Gemini e Magnific) em Meu perfil → "Minhas inteligências artificiais": a chave é validada numa chamada real antes de ser guardada (criptografada no servidor, só o final mascarado aparece), pode ser testada, ativada/desativada e removida com confirmação, e vale só para quem a cadastrou. Uma chave pessoal válida e ativa tem prioridade sobre a chave da organização e a do servidor; os modelos dela aparecem nos seletores e podem ser o padrão por finalidade (texto, copy, legendas, planejamento, tarefas, chat, edição de artes, imagem, edição e ampliação de imagem). O consumo com chave própria fica separado do consumo com credenciais da organização (ai_usage.key_source) e aparece na própria página. A organização controla a política em Configurações → Inteligência artificial (permitir chaves pessoais no geral e por provedor, com a contagem de pessoas conectadas, sem ver segredos). OpenAI e Magnific aceitam endereço de API personalizado (gateways compatíveis), só HTTPS e nunca endereços internos. Migração aditiva 0021 (ai_user_connections, allow_user_keys, key_source).
- **Problema resolvido:** Só a chave da organização (ou do servidor) podia ser usada: quem tinha crédito próprio num provedor não conseguia usá-lo, e o consumo de todo mundo caía na mesma conta.
- **Testes executados:**
  - tests/ai-connections.test.ts — criptografia/máscara, validação de endereço (SSRF, DNS), chave inválida não salva e não vaza, cadastro válido e isolamento entre pessoas e organizações, precedência pessoal > organização, seletor e padrão por finalidade com o modelo pessoal, uso com key_source e consumo separado, política geral e por provedor, endereço personalizado usado na chamada, testar/erro/remover, limite de tentativas
  - tests/ai-models.test.ts, tests/ai.test.ts — regressão da escolha de modelos e das gerações
  - e2e/ai-connections.spec.ts — página pessoal pelo perfil, provedores sem segredo, endereço só nos compatíveis, política da organização bloqueia e libera (desktop e celular)

## #29 — Magnific (Freepik AI): gerar, usar referência e ampliar imagens no editor

- **Data:** 2026-10-24
- **Módulo:** Estúdio Criador
- **Status:** Implementado e testado
- **Descrição:** A Magnific entrou como provedor de IA de imagem (API oficial), com chave por organização em Configurações → Inteligência artificial ou MAGNIFIC_API_KEY no servidor. Modelos do catálogo oficial: Mystic (geração em 1K/2K/4K com 13 proporções e "Usar a imagem selecionada como referência"), Classic rápido (instruções negativas e variações) e os ampliadores Magnific Precision v2 e Creative. O painel "Gerar imagem" ganhou a opção Resolução e a seção "Ampliar imagem selecionada" (2× a 16×, modelo escolhível). As tarefas assíncronas da Magnific são acompanhadas até concluir; o resultado vai para Arquivos e entra na arte pelo fluxo normal (inserir, fundo ou substituir). Erros de chave, créditos, limite e tarefa falha aparecem em linguagem clara, sem expor a credencial; o limite de 25,3 megapixels é conferido antes de gastar créditos. Validação contra a API real depende de uma chave da Magnific (não disponível neste ambiente).
- **Problema resolvido:** Só a OpenAI gerava imagens no editor; não havia como ampliar a resolução de uma imagem nem usar uma imagem da arte como referência de composição.
- **Testes executados:**
  - tests/magnific.test.ts — proporção nomeada e opções por modelo; chave validada por chamada real e catálogo só de imagem; Mystic com tarefa consultada até concluir e imagem salva; referência exige a política de dados e vai em base64; Classic síncrono com negativo e variações; ampliação (fator, limite de MP, modelo incompatível, arquivo/uso/histórico, Creative); erros (FAILED, 402, 429, 503) sem a chave
  - tests/design-image-gen.test.ts, tests/design-ai.test.ts, tests/ai*.test.ts — regressão dos provedores existentes (OpenAI inalterada)

## #28 — Inadimplência por cliente, contratos a vencer e carga da equipe

- **Data:** 2026-10-24
- **Módulo:** Financeiro e Dashboard
- **Status:** Implementado e testado
- **Descrição:** A Visão geral do Financeiro ganhou "Clientes inadimplentes" (faturas vencidas agrupadas por cliente, com atraso mais antigo e total, cada linha abrindo as faturas filtradas) e "Contratos a vencer" (serviços ativos que terminam em até 30 dias). A lista de Contratos tem o filtro "Término" (30/60/90 dias) e marca quanto falta para cada contrato acabar. Uma rotina diária nova (cron-contracts-expiring) emite o evento contract.expiring uma vez por contrato e data de término e avisa quem tem permissão financeira; o evento também está disponível nas automações. No Dashboard, quem gerencia vê "Clientes inadimplentes", "Contratos a vencer", "Pessoas sobrecarregadas" e o bloco "Carga da equipe (7 dias)" (mesma conta dos Relatórios), todos com link para a lista filtrada.
- **Problema resolvido:** O Financeiro só mostrava o total vencido, sem dizer quais clientes estavam devendo nem quais contratos estavam acabando; o Dashboard não tinha inadimplência nem carga da equipe. Ninguém era avisado quando um contrato chegava ao fim.
- **Testes executados:**
  - tests/finance.test.ts — inadimplência por cliente (só vencidas, agrupadas, ordenadas, rascunho atrasado não conta), contratos a vencer (janela, só ativos, filtro da lista, indicador e soma), rotina diária idempotente com novo aviso ao prorrogar e notificação só para quem tem finance.write
  - tests/dashboard.test.ts — indicadores de inadimplência/contratos/sobrecarga, carga por pessoa com capacidade e estimativa, nada para quem não gerencia
  - e2e/finance-alerts.spec.ts — contrato que termina em 10 dias e fatura vencida: visão geral, filtro de contratos, dashboard e notificação (desktop e celular; precisa de CRON_SECRET)

## #27 — Favoritos de modelos

- **Data:** 2026-10-24
- **Módulo:** Estúdio Criador
- **Status:** Implementado e testado
- **Descrição:** Cada pessoa pode marcar modelos como favoritos na galeria (estrela no cartão). Os favoritos aparecem primeiro em cada categoria e o filtro "Só favoritos" na aba Modelos mostra apenas eles. A marcação é por pessoa e vale só para modelos que ela pode ver. Migração aditiva 0020 (tabela design_favorites, com isolamento por organização).
- **Problema resolvido:** Agências com muitos modelos não tinham como destacar os que usam todo dia; cada pessoa precisava procurar o modelo pelo nome a cada arte.
- **Testes executados:**
  - tests/design-favorites.test.ts — marcar/desmarcar, sinal na listagem, filtro só da pessoa (outra pessoa não herda), modelo de cliente fora do escopo recusado, modelo da agência aceito
  - e2e/template-favorites.spec.ts — criar template a partir de uma arte, favoritar na galeria, filtro "Só favoritos", remover (desktop e celular)

## #26 — Texto do assistente vira demanda, histórico revisável e projeto na imagem

- **Data:** 2026-10-24
- **Módulo:** Criação com IA
- **Status:** Implementado e testado
- **Descrição:** No Assistente IA, todo texto gerado ganha o botão "Criar demanda com este texto": abre o formulário completo de demanda com título e descrição pré-preenchidos (projeto, responsável, prazo e prioridade à escolha; nada é criado sem confirmar). Reabrir uma sugestão de tarefas pelo histórico mostra a lista revisável (marcar, editar, criar no projeto) em vez do JSON bruto. Gerar imagem aceita um projeto opcional: a imagem é salva em Arquivos do projeto e do cliente dele.
- **Problema resolvido:** Um texto aprovado precisava ser copiado e colado numa nova tarefa; o histórico de sugestões de tarefas reabria como código; imagens do assistente só podiam ficar vinculadas ao cliente, não ao projeto.
- **Testes executados:**
  - e2e/ai-studio.spec.ts — sugestão de tarefas (demonstração) com 4 itens revisáveis; histórico reabre a lista sem JSON; Legendas → Criar demanda com este texto → formulário com título e descrição → demanda criada e aberta; seletor de projeto na geração de imagem
  - tests/ai.test.ts — geração de imagem com projeto (prepareImage resolve cliente e projeto) continua aprovada

## #25 — IA real antes da demonstração, artes na busca global, confirmação ao excluir pasta e tema ao vivo

- **Data:** 2026-10-24
- **Módulo:** Plataforma
- **Status:** Implementado e testado
- **Descrição:** A escolha automática de modelo nunca prefere a demonstração local quando há um provedor real compatível (a demonstração continua disponível por escolha explícita). A busca global (⌘K) passa a encontrar artes e templates do Estúdio Criador, abrindo o editor, dentro do escopo de clientes de quem busca. Excluir uma pasta da Biblioteca pede confirmação e explica que só pastas vazias são excluídas. Com o tema "Sistema", trocar o esquema do sistema operacional muda a aparência na hora, sem recarregar.
- **Problema resolvido:** Com OpenAI e demonstração ligadas juntas, tarefas estruturadas (como sugestão de tarefas) podiam receber uma resposta de exemplo em vez de IA real; artes não apareciam na busca; uma pasta podia ser excluída por um clique errado; o tema "Sistema" só acompanhava o sistema operacional depois de recarregar.
- **Testes executados:**
  - tests/ai-select.test.ts — provedor real (capacidade não confirmada) vence a demonstração em tarefas estruturadas, inclusive na prioridade de custo; demonstração sozinha continua escolhida; escolha explícita respeitada; prévia da interface igual ao servidor
  - tests/search.test.ts — artes com cliente, internas e templates nos resultados com link do editor; colaborador sem acesso ao cliente não vê a arte dele
  - e2e/cloud.spec.ts — Biblioteca (pastas, envio, versões) continua aprovada

## #24 — Gerar imagem com IA dentro do editor

- **Data:** 2026-10-24
- **Módulo:** Estúdio Criador
- **Status:** Implementado e testado
- **Descrição:** Novo painel Gerar imagem no editor (ícone na barra lateral, botão na seção Imagens de Fotos e Adicionar, "Gerar com IA" nas propriedades de uma imagem; gaveta no celular). Descrição com "Melhorar com IA" (com seletor próprio do modelo de texto, padrão salvável e alternativas quando o modelo escolhido não serve) e "Voltar ao texto original", contexto opcional do slide atual ou do carrossel inteiro (textos, sequência, imagens anteriores e identidade visual, respeitando a política de dados de clientes), seletor universal com só os modelos de imagem listados pela conta do provedor (padrão salvável), formatos 1:1, 4:5, 9:16, 16:9, formato do slide e personalizado, qualidade e variações conforme o provedor, oito estilos, resultados em grade com prévia ampliada e inserção no slide ativo como novo elemento, como fundo ou substituindo a imagem selecionada. Cada imagem gerada é recortada para a proporção pedida e salva em Arquivos (cliente e projeto da arte, origem IA, com descrição e modelo), e fica em "Geradas anteriormente" para reutilizar sem gerar de novo. Fechar o painel não perde a descrição nem os resultados.
- **Problema resolvido:** Para usar uma imagem gerada por IA numa arte era preciso sair do editor (Assistente IA ou ferramenta externa), baixar e enviar o arquivo; agora tudo acontece dentro do Estúdio Criador, com a imagem salva na nuvem e inserida no slide certo.
- **Testes executados:**
  - tests/design-image-gen.test.ts — proporções, tamanho do provedor e recorte, prompt com estilo e contexto; preparação com o modelo real da conta (opções do provedor, política de contexto, confirmação de custo); geração com a Images API simulada (n, quality, size), recorte 4:5, arquivos em Arquivos, uso e histórico; inserção como elemento, fundo e substituição com persistência ao salvar e reabrir; biblioteca de geradas; erros (provedor fora do ar, sem modelo de imagem, demonstração, permissão); melhorar descrição (demonstração e modelo real)
  - e2e/image-generator.spec.ts — painel no editor (computador e celular): vazio, descrição, melhorar com IA (demonstração), formato, modelo indisponível, fechar e reabrir mantendo os dados; com a rota de geração simulada no navegador: inserir no slide atual, como fundo, substituir, cancelar, erro, descartar, salvar e reabrir
- **Observações:** A geração real exige um provedor com modelos gpt-image (OpenAI) configurado em Configurações → Inteligência artificial; a demonstração local não gera imagens.

## #23 — Vários banners na capa, com setas e rolagem automática

- **Data:** 2026-10-23
- **Módulo:** Portal do cliente
- **Status:** Implementado e testado
- **Descrição:** Em Portal → Banner de capa, "Mais banners" adiciona até 9 banners extras, cada um com imagem, título, subtítulo, botão e ponto de foco próprios. Com 2 ou mais, o início do portal vira um carrossel: setas, pontos, toque para deslizar e rolagem automática com intervalo de 3 a 30 segundos, que pausa com o mouse sobre o banner e respeita a preferência de menos movimento. A prévia mostra o carrossel e o pacote de cliente aceita banners extras.
- **Problema resolvido:** A capa do portal só aceitava um banner; clientes com mais de uma campanha ou aviso não tinham como alternar.
- **Testes executados:**
  - tests/portal-banner.test.ts — chaves bannerN, esquema (padrões, limites, links), lista de arquivos referenciados, publicação e entrega de cada imagem, imagem de outro cliente recusada
  - e2e/portal-banner.spec.ts — dois banners na personalização viram carrossel na prévia (setas, pontos, rolagem automática, celular) e voltam a banner simples ao remover

## #22 — Fundo do logotipo e categoria automática na importação

- **Data:** 2026-10-23
- **Módulo:** Clientes
- **Status:** Implementado e testado
- **Descrição:** Em Marca → Logotipos, "Fundo do logotipo" define a cor atrás da logo nas miniaturas (cabeçalho do cliente e portal): Padrão, Branco, Preto ou outra cor. A importação de pacote passa a sugerir a categoria de clientes ativos e aceita, no manifesto, a categoria pelo nome e o fundo do logotipo.
- **Problema resolvido:** Uma logo preta sumia no cartão do tema escuro (e uma branca, no claro); e o cliente importado caía em "Sem categoria" mesmo quando a agência tinha a categoria "Clientes ativos".
- **Testes executados:**
  - tests/client-package.test.ts — categoria pelo nome (sem diferenciar maiúsculas), categoria escolhida vence o manifesto, nome desconhecido fica sem categoria; fundo do logotipo aceita hex, limpa e rejeita inválido
  - e2e/client-import.spec.ts — fundo do pacote aparece no cabeçalho; trocar para Branco em Marca atualiza o cabeçalho

## #21 — Importar pacote de cliente

- **Data:** 2026-10-23
- **Módulo:** Clientes
- **Status:** Implementado e testado
- **Descrição:** Clientes → Importar pacote recebe um .zip com manifest.json e cria de uma vez o cliente, o perfil da marca, a biblioteca (logotipos, materiais, manual), os projetos com demandas e a personalização do portal já publicada. Tudo numa transação: se algo falhar, nada fica pela metade. Formato em docs/PACOTE-DE-CLIENTE.md.
- **Problema resolvido:** Levar um cliente preparado em outro ambiente (marca extraída do Figma, demandas redigidas, artes do portal) para a plataforma exigia recadastrar tudo a mão.
- **Testes executados:**
  - tests/client-package.test.ts — importação completa, pacote zipado como pasta, rejeições (sem manifesto, inválido, arquivo ausente) sem cliente pela metade, permissão
  - e2e/client-import.spec.ts — diálogo Importar pacote cria o cliente e abre a ficha com projeto e logotipo

## #20 — Relatório cabe na tela do celular

- **Data:** 2026-10-23
- **Módulo:** Radar de Marca
- **Status:** Implementado e testado
- **Descrição:** As tabelas do relatório deixam de alargar a página em telas pequenas: as seções têm largura mínima zero e as tabelas rolam na horizontal quando precisam.
- **Problema resolvido:** Em 390 px a página do relatório ficava com 401 px e o navegador ampliava a área de layout (detectado pelo teste de largura, que agora compara com a largura real da janela).
- **Testes executados:**
  - e2e/brand-radar.spec.ts — critério 7 no celular (5 aprovados + 1 pulado na suíte)

## #19 — Chat flutuante em qualquer módulo e avisos de eventos

- **Data:** 2026-10-23
- **Módulo:** Chat da Equipe
- **Status:** Implementado e testado
- **Descrição:** Botão do chat no cabeçalho (e no editor do Estúdio Criador) abre o Chat da Equipe numa janela flutuante sobre a página atual, com minimizar, restaurar, fechar e abrir em tela cheia; a conversa e o rascunho continuam ao navegar entre módulos. Clicar num aviso de mensagem abre a conversa na janela, sem sair da página. Avisos de eventos da plataforma (comentários, tarefas, aprovações, solicitações) aparecem como janelas no canto superior direito, com título, prévia, hora, abrir e dispensar. No celular, a janela do chat ocupa a tela.
- **Problema resolvido:** Para responder uma mensagem era preciso sair da tela em que se estava trabalhando; os avisos do sino só apareciam ao abrir o sino.
- **Testes executados:**
  - e2e/chat-dock.spec.ts — abrir/minimizar/restaurar/fechar, mensagem real, navegação, aviso abre a conversa, editor com canvas à vista, login sem chat, aviso de evento abre a demanda (desktop e celular)
  - e2e/chat-notifications.spec.ts — janela flutuante, som, agrupamento e reconexão
  - e2e/chat.spec.ts — conversa em tempo real e clientes sem acesso
- **Observações:** O chat continua usando a consulta periódica ao servidor (4 a 8 s com a aba visível) — não há WebSocket na hospedagem serverless. As mensagens ficam só no banco; a janela guarda apenas se estava aberta e qual conversa. Avisos de eventos não tocam som.

## #18 — Editor: aparência escura, zoom no cabeçalho e faixa de slides

- **Data:** 2026-10-23
- **Módulo:** Estúdio Criador
- **Status:** Implementado e testado
- **Descrição:** O editor abre com aparência escura (troca em “Mais ações” → Aparência do editor) e devolve o tema do aplicativo ao sair. Botões − / + de zoom ao lado da porcentagem e troca rápida de formato no cabeçalho (Vertical 9:16, Post 4:5, Quadrado 1:1, Paisagem 16:9; os demais no painel da página). Barra lateral na ordem da referência: Modelos, Adicionar, Fotos, Marca, Componentes, Camadas. No carrossel, cada prancheta mostra “Slide N”, o slide ativo tem “Duplicar” e uma prancheta tracejada “+” depois do último slide adiciona um novo.
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
