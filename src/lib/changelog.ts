/*
 * Registro de atualizações exibido em /updates e espelhado em docs/CHANGELOG.md.
 * Entra aqui apenas o que foi implementado E testado (testes listados em
 * `tests`). Publicação em produção depende da implantação de cada ambiente —
 * por isso o status fala de teste, não de publicação.
 */

export const CHANGELOG_STATUS = {
  tested: "Implementado e testado",
  partial: "Implementado em parte",
} as const;

export type ChangelogEntry = {
  /** Número sequencial (o mais novo é o maior). */
  n: number;
  /** AAAA-MM-DD */
  date: string;
  module: string;
  title: string;
  description: string;
  /** Problema que a mudança resolve. */
  fixed: string;
  status: keyof typeof CHANGELOG_STATUS;
  /** Testes automatizados executados (arquivo e o que cobre). */
  tests: string[];
  notes?: string;
};

export const CHANGELOG: ChangelogEntry[] = [
  {
    n: 1,
    date: "2026-10-22",
    module: "Estúdio de Carrosséis",
    title: "Canvas sempre visível no editor",
    description:
      "Painel lateral e painel de propriedades podem ser recolhidos (a preferência fica no aparelho). Com o assistente de IA aberto em telas menores, o painel lateral recolhe sozinho. Ao redimensionar, a visualização continua centralizada.",
    fixed:
      "Em 1024 px com o assistente de IA aberto, o canvas ficava com cerca de 380 px de largura. Agora fica com 636 px; em 1280 px, com os dois painéis recolhidos, 1232 px.",
    status: "tested",
    tests: ["e2e/editor.spec.ts — editor completo (desktop)", "Capturas em 1024, 1280 e 1440 px para medir o canvas"],
  },
  {
    n: 2,
    date: "2026-10-22",
    module: "Estúdio de Carrosséis",
    title: "Miniaturas reais das páginas",
    description:
      "A lista de páginas do carrossel mostra a miniatura de cada página, nome em duas linhas e ações sobre a miniatura (sempre visíveis em telas de toque).",
    fixed: "Os nomes das páginas eram espremidos pelos botões e não havia prévia do conteúdo.",
    status: "tested",
    tests: ["e2e/editor.spec.ts"],
    notes: "As miniaturas são atualizadas só para a página alterada e as vizinhas do carrossel, para não pesar.",
  },
  {
    n: 3,
    date: "2026-10-22",
    module: "Estúdio de Carrosséis",
    title: "Importação de modelo por imagem com erros claros",
    description:
      "Importar modelo aceita JPG, PNG e WebP. Imagens grandes são reduzidas e recomprimidas no navegador antes do envio, com aviso do que foi feito. Formato inválido, arquivo vazio, imagem corrompida ou grande demais geram mensagem específica.",
    fixed:
      "Falhas na importação de JPG apareciam como erro genérico (ou resposta não-JSON do servidor) sem dizer o motivo. Nenhuma mensagem pede para excluir projetos.",
    status: "tested",
    tests: ["e2e/carousel-generator.spec.ts — importação de modelo com aviso"],
  },
  {
    n: 4,
    date: "2026-10-22",
    module: "Navegação",
    title: "Menu lateral profissional",
    description:
      "Cabeçalho com logo e nome da plataforma, troca de organização, botão de recolher com dicas quando recolhido, contadores reais e nova ordem: Minhas demandas, Dashboard, Clientes, Biblioteca, Estúdio de Carrosséis, Criação com IA, Calendário, Redes sociais, Financeiro, Relatórios e Lixeira.",
    fixed: "O menu não tinha identidade nem atalhos para o trabalho do dia; itens importantes ficavam escondidos.",
    status: "tested",
    tests: ["e2e/demands.spec.ts", "e2e/brand-radar.spec.ts e e2e/design-ai.spec.ts (títulos atualizados)"],
    notes: "Vendas/CRM não foi incluído porque ainda não existe — nenhum item do menu leva a uma tela vazia.",
  },
  {
    n: 5,
    date: "2026-10-22",
    module: "Clientes",
    title: "Categorias de clientes configuráveis",
    description:
      "Categorias com cor, contagem, ordem e expandir/recolher no menu e na lista de clientes. Criar, renomear, reordenar e excluir (os clientes voltam para “Sem categoria”). Mover um cliente nunca duplica o registro.",
    fixed: "Não havia como organizar a carteira (ativos, avulsos, ex-clientes).",
    status: "tested",
    tests: [
      "tests/client-categories.test.ts — 6 testes (escopo, contagem, exclusão sem perder cliente)",
      "e2e/demands.spec.ts — criar, mover e excluir categoria pelo menu",
    ],
    notes: "Migração aditiva 0016 cria três categorias padrão em cada organização.",
  },
  {
    n: 6,
    date: "2026-10-22",
    module: "Minhas demandas",
    title: "Minhas demandas",
    description:
      "Saudação, busca, “Ver como” (para quem pode atribuir), nova demanda pelo modal, indicadores clicáveis (Atrasadas, Para hoje, Próximos 7 dias, Todas abertas) sem contagem dupla, visões Lista e Minha semana (arrastar muda o prazo) e agrupamento por etapa ou por prazo.",
    fixed: "Cada pessoa precisava filtrar a lista geral de tarefas para ver o próprio trabalho.",
    status: "tested",
    tests: [
      "tests/demands.test.ts — 4 testes (indicadores e permissão)",
      "e2e/demands.spec.ts — indicadores, modal e semana",
    ],
  },
  {
    n: 7,
    date: "2026-10-22",
    module: "Portal do cliente",
    title: "Login do portal com a marca do cliente",
    description:
      "Novo layout em cartão: logo do cliente, cartão escuro “Bem-vindo”, campos com ícones, mostrar/ocultar senha, “Mantenha-me conectado”, “Esqueceu a senha?”, botão na cor da marca, link de Política de Privacidade e arte lateral.",
    fixed: "A tela de entrada do portal não seguia a identidade de cada cliente.",
    status: "tested",
    tests: ["tests/portal-login.test.ts — 4 testes", "e2e/portal.spec.ts e e2e/portal-acceptance.spec.ts"],
  },
  {
    n: 8,
    date: "2026-10-22",
    module: "Portal do cliente",
    title: "Página de demandas do cliente",
    description:
      "No portal, o cliente vê só as próprias demandas, com indicadores (Em aberto, Em produção, Aguardando sua aprovação, Entregues) e “Nova demanda”. Outros clientes nunca aparecem.",
    fixed: "O cliente não tinha uma visão única das demandas dele.",
    status: "tested",
    tests: ["e2e/portal.spec.ts", "tests/requests.test.ts e tests/portal.test.ts — cliente só vê e abre o que é dele"],
  },
  {
    n: 9,
    date: "2026-10-22",
    module: "Aprovações",
    title: "Aprovação por link, sem conta",
    description:
      "Gere um link com validade para o cliente aprovar ou pedir ajustes nas peças pendentes sem criar conta. O link mostra só a versão atual de cada peça, registra o nome de quem decidiu, pode ser revogado e tem limite de tentativas.",
    fixed: "Clientes sem acesso ao portal não conseguiam aprovar pela plataforma.",
    status: "tested",
    tests: ["tests/approval-links.test.ts — 6 testes", "e2e/approval-link.spec.ts"],
    notes: "O token fica guardado como hash no banco; o link completo aparece uma única vez.",
  },
  {
    n: 10,
    date: "2026-10-22",
    module: "Demandas e Estúdio",
    title: "Artes ligadas à demanda e ao projeto",
    description:
      "A demanda mostra “Artes da demanda” com miniaturas e cria uma arte ou carrossel já vinculado. O projeto ganhou a aba Artes. São os mesmos registros do Estúdio, sem cópia.",
    fixed: "Arte e demanda viviam separadas; era preciso procurar a peça no Estúdio.",
    status: "tested",
    tests: ["tests/design-links.test.ts — 2 testes (vínculo e permissão)"],
  },
  {
    n: 11,
    date: "2026-10-22",
    module: "Dashboard",
    title: "Dashboard com dados reais",
    description:
      "Boas-vindas, atalhos, indicadores de demandas, Estúdio com miniaturas reais, uso de IA no mês, projetos recentes (grade ou lista), agenda de prazos, aprovações e atividade.",
    fixed: "O painel inicial não mostrava o trabalho recente nem atalhos para as ferramentas.",
    status: "tested",
    tests: ["tests/dashboard.test.ts — 3 testes"],
  },
  {
    n: 12,
    date: "2026-10-22",
    module: "Calendário",
    title: "Criar demanda a partir de um dia",
    description:
      "Calendário próprio no menu (mês, semana e dia), com “+” em cada dia e “Nova demanda neste dia”. Arrastar muda o prazo do mesmo registro.",
    fixed: "Para agendar era preciso criar a tarefa em outra tela e digitar a data.",
    status: "tested",
    tests: ["e2e/demands.spec.ts — criar pelo calendário", "e2e/tasks.spec.ts — 7 testes"],
  },
  {
    n: 13,
    date: "2026-10-22",
    module: "Rotina",
    title: "Rotina: tarefas recorrentes",
    description:
      "Tarefas diárias, semanais ou mensais criadas automaticamente no projeto escolhido, com responsável, prioridade e prazo. Prévia das próximas datas, pausar, retomar e excluir (as tarefas criadas continuam).",
    fixed: "Tarefas repetitivas (relatórios, organização, escala de stories) dependiam de lembrança.",
    status: "tested",
    tests: [
      "tests/recurrence.test.ts — 5 testes (datas)",
      "tests/routines-references.test.ts — geração sem duplicar",
      "e2e/routines-references.spec.ts — desktop e celular",
    ],
    notes: "Uma tarefa por data, garantida por índice único no banco.",
  },
  {
    n: 14,
    date: "2026-10-22",
    module: "Biblioteca",
    title: "Referências por link",
    description:
      "Aba Referências na Biblioteca: salve links de YouTube, Instagram, Pinterest, TikTok, Behance ou qualquer página, com etiquetas, cliente e observação. Busca e filtros por origem e cliente.",
    fixed: "Inspirações ficavam espalhadas em conversas e favoritos pessoais.",
    status: "tested",
    tests: ["tests/routines-references.test.ts — escopo por cliente", "e2e/routines-references.spec.ts"],
    notes: "O servidor não acessa os links salvos; só o YouTube tem miniatura.",
  },
];

export const CHANGELOG_MODULES = [...new Set(CHANGELOG.map((e) => e.module))].sort((a, b) =>
  a.localeCompare(b, "pt-BR"),
);
