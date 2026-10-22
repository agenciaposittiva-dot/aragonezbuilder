/*
 * Conteúdo do "Me guie": dicas da tela atual e o tour rápido pelas áreas.
 * Cada dica descreve um controle que existe na tela (sem prometer recurso
 * que não há). Os primeiros passos vêm do servidor (src/server/services/guide.ts).
 */

type ScreenTips = { match: (path: string) => boolean; title: string; tips: string[] };

const UUID = "[0-9a-f-]{36}";

const SCREENS: ScreenTips[] = [
  {
    match: (p) => p === "" || p === "/",
    title: "Dashboard",
    tips: [
      "Os atalhos do topo levam direto para criar projeto, carrossel, imagem com IA e conteúdo.",
      "Clique em um indicador de demandas para abrir a lista já filtrada.",
      "A agenda mostra as suas entregas e os prazos de projetos dos próximos 7 dias.",
    ],
  },
  {
    match: (p) => p.startsWith("/demandas"),
    title: "Minhas demandas",
    tips: [
      "Clique em Atrasadas, Para hoje, Próximos 7 dias ou Todas abertas para filtrar a lista.",
      "Em “Minha semana”, arraste o cartão para outro dia para mudar o prazo.",
      "“Por prazo” agrupa por data; “Por etapa” agrupa pelas etapas do fluxo.",
    ],
  },
  {
    match: (p) => p === "/clients" || p.startsWith("/clients?"),
    title: "Clientes",
    tips: [
      "Organize a carteira pelas categorias do menu lateral (criar, renomear, reordenar e cores).",
      "Troque a categoria de um cliente direto na coluna Categoria — ele nunca é duplicado.",
    ],
  },
  {
    match: (p) => new RegExp(`^/clients/${UUID}/portal`).test(p),
    title: "Portal do cliente",
    tips: [
      "Personalize logo, cores e arte de fundo e veja a prévia no computador e no celular.",
      "O rascunho só aparece para o cliente depois de publicar.",
    ],
  },
  {
    match: (p) => p.startsWith("/files/referencias"),
    title: "Referências",
    tips: [
      "Cole o link: a origem (YouTube, Instagram, Pinterest…) é reconhecida pelo endereço.",
      "Use etiquetas para achar depois pela busca.",
    ],
  },
  {
    match: (p) => p.startsWith("/files"),
    title: "Biblioteca",
    tips: [
      "Envie arquivos arrastando para a janela de envio; o tipo real é conferido no servidor.",
      "A aba Referências guarda links de inspiração da equipe.",
    ],
  },
  {
    match: (p) => p === "/studio",
    title: "Estúdio de Carrosséis",
    tips: [
      "“Gerar carrossel com IA” cria as páginas a partir de um tema.",
      "“Importar JPG/PNG” transforma uma imagem em modelo editável.",
    ],
  },
  {
    match: (p) => new RegExp(`^/studio/${UUID}`).test(p),
    title: "Editor",
    tips: [
      "Recolha o painel lateral ou o de propriedades para ampliar o canvas.",
      "A lista de páginas mostra a miniatura de cada uma; passe o mouse para duplicar ou excluir.",
      "As alterações são salvas automaticamente; o indicador no topo mostra o estado.",
    ],
  },
  {
    match: (p) => p.startsWith("/tasks"),
    title: "Tarefas e calendário",
    tips: [
      "No calendário, use o “+” de um dia para criar uma demanda com essa data.",
      "Arraste uma tarefa para outro dia para mudar o prazo do mesmo registro.",
    ],
  },
  {
    match: (p) => p.startsWith("/approvals"),
    title: "Aprovações",
    tips: [
      "Em “Links de aprovação”, gere um link para o cliente aprovar sem criar conta.",
      "O link mostra só a versão atual de cada peça e pode ser revogado a qualquer momento.",
    ],
  },
  {
    match: (p) => p.startsWith("/rotina"),
    title: "Rotina",
    tips: [
      "Cada rotina cria a tarefa na data certa, uma única vez por data.",
      "Pausar interrompe a criação; ao retomar, as datas recomeçam de hoje.",
    ],
  },
  {
    match: (p) => p.startsWith("/ai"),
    title: "Criação com IA",
    tips: [
      "Sem provedor configurado, a tela avisa em vez de inventar resultado.",
      "Quem administra a agência conecta a chave em Configurações › IA.",
    ],
  },
];

/** Dicas da tela atual (caminho sem o prefixo /w/[org]). */
export function tipsFor(path: string): { title: string; tips: string[] } | null {
  const hit = SCREENS.find((s) => s.match(path));
  return hit ? { title: hit.title, tips: hit.tips } : null;
}

export type TourStop = { title: string; text: string; path: string; permission?: string };

/** Tour rápido pelas áreas principais (cada parada leva à tela). */
export const TOUR: TourStop[] = [
  {
    title: "Minhas demandas",
    text: "Seu trabalho do dia: atrasadas, para hoje e próximos 7 dias, em lista ou na semana.",
    path: "/demandas",
    permission: "tasks.read",
  },
  {
    title: "Clientes",
    text: "Carteira organizada por categorias, com projetos, arquivos, marca e portal de cada cliente.",
    path: "/clients",
    permission: "clients.read",
  },
  {
    title: "Estúdio de Carrosséis",
    text: "Crie artes e carrosséis do zero, de modelos prontos, de uma imagem ou com IA.",
    path: "/studio",
    permission: "designs.read",
  },
  {
    title: "Biblioteca",
    text: "Arquivos e referências da agência e dos clientes, salvos no servidor.",
    path: "/files",
    permission: "files.read",
  },
  {
    title: "Calendário",
    text: "Prazos por mês, semana ou dia; crie uma demanda direto no dia.",
    path: "/tasks?view=calendar",
    permission: "tasks.read",
  },
  {
    title: "Aprovações",
    text: "Revisão interna, aprovação do cliente pelo portal ou por link sem conta.",
    path: "/approvals",
    permission: "files.read",
  },
];
