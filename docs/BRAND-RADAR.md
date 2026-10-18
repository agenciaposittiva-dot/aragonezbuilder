# Radar de Marca — diagnóstico do Instagram

Módulo estratégico que avalia o perfil do Instagram de cada cliente (bio,
destaques, identidade visual, conteúdo, nicho e concorrentes) e gera um plano
de ação. Fica em **Operação → Radar de Marca** (`/w/<org>/brand-radar`), separado
do Radar de Tendências.

## Princípios

- **Nada inventado.** Métricas só aparecem quando vêm da conta conectada pela
  API oficial. Números informados pela equipe ficam marcados como "informado,
  não verificado" e nunca entram como métrica.
- **Fonte e data de cada dado.** Todo valor usado numa análise guarda a origem
  (`manual`, `screenshot`, `instagram_api`, `client_record`) e a data da coleta.
  Os dados usados ficam congelados junto com o diagnóstico.
- **Observado × avaliação da IA × informação insuficiente.** Cada afirmação traz
  a base. "Observado" sem evidência vira "avaliação da IA" automaticamente.
- **Sem trocar de provedor em silêncio.** A IA usa o seletor universal (tarefa
  `brand_analysis`, módulo `brand`). Provedor e modelo ficam gravados em cada
  diagnóstico. O modo demonstração é identificado em todas as telas.
- **O Instagram nunca é alterado.** "Usar esta versão" grava a bio no cadastro
  do perfil na plataforma; aprovar a bio não muda nada no Instagram.

## Metodologia da nota (versão 1)

A nota de 0 a 100 é a **média ponderada só das dimensões avaliadas**. Dimensões
sem os dados necessários ficam "não avaliadas" e fora da conta (a tela mostra
quantos pontos de peso entraram). Pesos e limite da bio são configuráveis em
"Pesos e limites" (quem tem `org.manage`); cada diagnóstico guarda os pesos que
usou e a comparação avisa quando eles mudam.

| Dimensão | Peso padrão | Quem avalia | Precisa de |
| --- | --- | --- | --- |
| Clareza do posicionamento | 12 | IA | bio, nome ou categoria |
| Qualidade da biografia | 12 | IA | bio, nome ou categoria |
| Completude do perfil | 6 | Regra | bio, nome ou categoria |
| Identidade visual | 12 | IA (com visão) | capturas lidas por modelo com visão |
| Organização dos destaques | 8 | IA | destaques |
| Qualidade e consistência do conteúdo | 12 | IA | publicações |
| Clareza das chamadas para ação | 8 | IA | bio, nome ou categoria |
| Adequação ao público e ao nicho | 10 | IA | nicho ou perfil de marca do cliente |
| Uso estratégico dos formatos | 6 | Regra | 3+ publicações com formato |
| Consistência da comunicação | 8 | IA | publicações |
| Desempenho | 6 | Regra | métricas reais da conta conectada |

Regras objetivas (`src/lib/brand-radar.ts`):

- **Completude:** bio preenchida, dentro do limite, com chamada para ação, link,
  nome/categoria e destaques (destaques desconhecidos ficam fora da conta).
- **Formatos:** usa 2+ formatos; usa os 3 formatos; nenhum formato acima de 70%.
- **Desempenho:** média de (curtidas + comentários) por publicação ÷ seguidores,
  só com dados da API: ≥ 3% → 100; 1–3% → 70; 0,5–1% → 45; < 0,5% → 25. É uma
  referência interna, não um padrão oficial do Instagram.

Regras aplicadas depois da resposta da IA (`src/server/services/brand-radar-ai.ts`,
listadas em "Regras aplicadas pelo sistema" em cada diagnóstico):

- notas da IA para dimensões sem dados são descartadas;
- números que não constam nos dados são removidos dos textos (na bio, viram
  `[confirmar]` com alerta);
- a contagem de caracteres da bio é refeita pelo sistema (emoji conta como um);
- identidade visual só é avaliada quando as imagens foram de fato enviadas a um
  modelo que lê imagens; sem publicações, categorias de conteúdo ficam "não dá
  para avaliar";
- concorrentes citados fora da lista cadastrada são descartados.

Mudou critério ou peso padrão? Suba `BRAND_METHODOLOGY_VERSION`.

## Entrada de dados

1. **Por @ ou endereço + cliente** — todo perfil pertence a um cliente (e às
   permissões dele). Prospects precisam ser cadastrados como cliente antes.
2. **Entrada manual** — nome, categoria, bio, link, seguidores (não verificado),
   destaques, publicações (formato + tema) e **capturas de tela**, enviadas para
   Arquivos do cliente (`category: reference`, tags `radar-de-marca`).
3. **Conexão oficial** — ver abaixo.
4. **Concorrentes** — só o que a equipe informa (bio e observações). Não há
   coleta automática nem raspagem de outros perfis.

## Conexão oficial com o Instagram (API da Meta)

Usa a **Instagram API com login do Instagram** (conta profissional: comercial ou
criador de conteúdo). A pessoa entra no próprio Instagram — nunca pedimos senha,
não há raspagem nem automação de login — e a conexão só **lê** perfil e
publicações (curtidas e comentários). Permissão pedida: `instagram_business_basic`.

### Configurar

1. Em <https://developers.facebook.com/apps>, crie um app do tipo **Empresa** e
   adicione o produto **Instagram** → "API com login do Instagram".
2. Em "Configurar login comercial", cadastre a URI de redirecionamento:
   `<APP_URL>/api/brand-radar/instagram/callback` (exatamente igual ao `APP_URL`
   do servidor).
3. Copie o ID e a chave secreta do app do Instagram para as variáveis do servidor:
   `META_APP_ID`, `META_APP_SECRET` (opcional: `META_GRAPH_VERSION`, padrão
   `v23.0`).
4. Enquanto o app estiver em modo de desenvolvimento, só contas adicionadas como
   testadoras conseguem autorizar. Para clientes reais, o app precisa passar pela
   análise da Meta (permissão `instagram_business_basic`).

Sem essas variáveis, a tela mostra "Integração não configurada" e o Radar
funciona com a entrada manual.

### Como funciona

- `GET /api/brand-radar/instagram/connect?org=&profile=` → redireciona para
  `https://www.instagram.com/oauth/authorize` com um **estado assinado** (HMAC,
  vale 10 minutos e só para a pessoa que iniciou).
- O retorno troca o código pelo token curto e depois pelo de longa duração
  (~60 dias), confere se a conta autorizada é o mesmo @ do perfil e guarda o
  token **criptografado** (AES-256-GCM, `src/server/crypto.ts`).
- "Atualizar dados" lê perfil e até 25 publicações e renova o token quando
  faltam menos de 7 dias (a Meta só renova tokens com mais de 24 h).
- Token vencido ou revogado (erro 190) → situação "Autorização vencida" e botão
  "Conectar de novo". "Desconectar" apaga o token; para revogar também no
  Instagram: Configurações → Apps e sites.
- Bio e site nem sempre vêm por essa API: se não vierem, ficam como "não
  informado" e a equipe pode completar manualmente.

**Não testado contra a Meta real** neste ambiente: o fluxo está coberto por
testes com as respostas da API simuladas (`tests/brand-radar.test.ts`).

## Integrações

- **Bio:** editar (gera versão "editada"), copiar, comparar, "Usar esta versão"
  (cadastro do perfil), "Enviar para aprovação" (arquivo `.txt` do cliente +
  fluxo de aprovações) e "Criar tarefa de implementação".
- **Destaques:** capa (1080×1920) e Stories (uma tela por ideia) no editor
  (documento formato 2, com as cores e a fonte do perfil de marca) e tarefa.
- **Recomendações:** tarefa (projeto existente ou novo), arte para feed,
  carrossel, Stories ou capa, conteúdo (rascunho no calendário) e campanha.
  Situação, prioridade, responsável e prazo editáveis.
- **Exportação:** plano de ação em CSV (`/api/brand-radar/export`) e relatório
  para imprimir ou salvar em PDF (`/w/<org>/brand-radar/<id>/report`).

## Permissões

- `brand.read` — ver o Radar (proprietário, administrador, gestor, atendimento,
  designer, redator, social media, tráfego).
- `brand.manage` — cadastrar perfis, informar dados, rodar análises, conectar
  contas e gerenciar recomendações (proprietário, administrador, gestor,
  atendimento, social media).
- Tudo respeita o escopo de clientes do usuário (`clientScope`) e o isolamento
  por organização (RLS). Usuários do portal do cliente não acessam o Radar.
- Enviar dados de clientes a um provedor de IA exige "Permitir contexto de
  clientes" nas configurações de IA (o modelo de demonstração não envia nada).
