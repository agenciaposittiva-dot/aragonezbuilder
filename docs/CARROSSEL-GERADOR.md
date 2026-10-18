# Gerador automático de carrosséis com IA

Gera um carrossel completo e editável no Estúdio a partir de um assunto (modo
rápido) ou de um briefing (modo completo). O resultado é uma arte comum do
editor (formato 2, páginas conectadas), salva na nuvem central, com o plano
guardado em `document.meta.generator`.

Entradas na interface: **Estúdio → Gerar carrossel com IA**, **Assistente IA →
Gerar carrossel com IA** e **Cliente → Gerar carrossel** (já com o cliente).
No editor, em **Mais ações → Gerador de carrosséis**: regenerar este slide,
nova direção visual, gerar segunda versão e plano/dados a confirmar.

## Fluxo

| Etapa (progresso real)      | O que acontece                                                                                                                                                                                                                     |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Planejando conteúdo         | Modelo escolhido no seletor universal (módulo `carousel`, tarefa `planning`) devolve estratégia, narrativa e roteiro em JSON validado. Custo acima do limite pede confirmação; uso e erro sempre registrados.                        |
| Criando roteiro             | Regras sobre a resposta: quantidade de slides, capa/chamada final, limites de texto. **Nenhum número entra como dado sem estar nas referências da equipe**; números citados viram "dados a confirmar" (`meta.generator.claims`).       |
| Preparando recursos visuais | Imagens dos Arquivos escolhidas pela equipe e imagens geradas pelo modelo de imagem (módulo `carousel`, tarefa `image_generation`), salvas nos Arquivos do cliente. Sem modelo de imagem: só formas, ícones e tipografia, com aviso. |
| Montando slides             | Direção de arte (identidade do cliente ou sugestão revisável) e composição por papel do slide (`src/lib/carousel-gen`).                                                                                                               |
| Salvando projeto            | `createDesign` com o documento; "salvo" só depois da confirmação do banco.                                                                                                                                                         |

Privacidade: o perfil da marca só vai ao provedor quando a organização autoriza
"dados de clientes" (Configurações → IA). Cores, fontes e logo são aplicadas
localmente. A logo usada é sempre a do **cliente** (`clients.logoFileId`).

## Qualidade aplicada pelo motor (`src/lib/carousel-gen`)

- Várias composições por papel (capa, problema/contexto/ideia, dado, lista,
  passo a passo, comparação, citação, resumo, chamada final); a semente da
  direção escolhe uma por carrossel (unidade) e temas diferentes geram
  carrosséis diferentes (variação).
- Elemento de continuidade atravessando cada divisa de slide (borda direita →
  próximo slide), contador `02/07` e barra de progresso, "arraste" na capa.
- Margens e área segura fixas, texto ajustado (mesma conta de altura do editor),
  contraste WCAG AA verificado sobre o fundo, cartão ou forma atrás do texto.
- Tudo editável: textos são objetos de texto, ícones são caminhos, imagens são
  arquivos da plataforma. Objetos têm ids estáveis por slide (`<slide>-title`,
  `<slide>-body`, `<slide>-b0`…), usados para manter edições ao trocar a direção.

## API para o chat de edição (Frente L) e integrações

Serviços em `src/server/services/carousel-generator.ts` (todos verificam
permissões e o cliente da arte; IA sempre pelo seletor universal):

```ts
// Geração completa (sem transmissão) — devolve designId e os eventos de progresso.
generateCarousel(actor, input: CarouselGenerateInput)
// Com transmissão: prepareCarousel(scope, input) + runCarouselGeneration(actor, prepared, { send, signal })

// Regenera UM slide com a IA. Grava a versão "Antes de regenerar o slide N"
// e aplica [replacePage, replaceMeta] com controle de revisão.
regenerateCarouselSlide(actor, { designId, revision, pageId, instruction?, keepImage?, selection?, confirmCost? })
  → { revision, ops, slideIndex, claims, warnings, demo, notice }

// Nova direção visual mantendo textos (inclusive editados) e imagens. Sem custo de IA.
restyleCarousel(scope, { designId, revision }) → { revision, ops, direction }

// Segunda versão: arte NOVA com outra composição; a original não muda.
createCarouselVariant(scope, { designId }) → { id, layouts }
```

Server Actions (`src/server/actions/carousel-generator.ts`):
`regenerateCarouselSlideAction`, `restyleCarouselAction`,
`carouselVariantAction`. Rota com progresso: `POST /api/studio/generate-carousel`
(NDJSON: `{t:"meta"}`, `{t:"step", step, status, detail?}`, `{t:"done", designId}`
ou `{t:"error"}`; antes da transmissão, `409 cost_confirmation` e `422
model_selection`).

**Como o editor aplica o resultado** (o chat deve fazer igual): `flush` do
salvamento automático → chamar a ação com `revision` atual → `store.dispatch(ops,
{ reason: "silent" })` (mesmo lote que o servidor aplicou, entra no desfazer) →
usar a `revision` devolvida. Em `ConflictError`, recarregar a arte.

### Ligado ao chat de edição (Frente L)

Ferramentas registradas em `src/server/services/design-ai-tools.ts`
(`registerDesignAiTool`), só valem quando o contexto tem `generator`:

| Ferramenta           | Exemplos de pedido                                  | Execução                                                    |
| -------------------- | --------------------------------------------------- | ----------------------------------------------------------- |
| `carousel_slide`     | "reescreva o slide 3", "deixe a capa mais impactante" | `planCarouselSlide` → operações para a prévia               |
| `carousel_direction` | "mude só a direção visual"                          | `planCarouselRestyle` → operações para a prévia (sem custo) |
| `carousel_variant`   | "gere uma segunda versão"                           | `createCarouselVariant` → arte nova e link para abrir       |

O chat (`src/components/studio/design-ai-chat.tsx`, `ACTION_EXECUTORS` e
`ACTION_VIEWS`) chama `POST /api/designs/ai/carousel` com o documento aberto no
editor; as operações entram na mesma prévia/aplicar/desfazer do chat, com o
ponto de controle dele. O carrossel gerado mostra sugestões próprias no chat.
Ao terminar a geração, o aviso oferece **Visualizar publicação** (Frente M).

## Importar JPG/PNG como modelo

`POST /api/studio/import-template` (multipart) → `importImageAsTemplate`
(`src/server/services/design-import.ts`). A original vai para Arquivos (categoria
"referência", do cliente quando houver) e vira a camada de fundo bloqueada. Com
um modelo de leitura de imagens (tarefa `reference_analysis`), a IA reconstrói
textos e blocos de cor em camadas editáveis e a original fica oculta e
bloqueada (recuperável em Camadas). Sem esse modelo — ou se a leitura falhar —
só a camada de fundo é criada e a resposta diz isso. Origem em `meta.imported`.

## Modo demonstração

Provedor local `demo`: roteiro determinístico que muda com o tema (sequência de
slides e frases), sem números inventados (só os das referências), marcado como
exemplo na legenda, nos avisos e no selo "Demonstração". Não gera imagens nem
lê imagens.
