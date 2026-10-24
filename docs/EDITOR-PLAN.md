# Editor profissional do Estúdio — auditoria, plano e decisões

Módulo 1 do pedido "Editor profissional, IA em toda a operação e Central de
Tendências" (itens 1.1 a 1.4). Este documento registra o que existia, o que
mudou e como as próximas frentes (chat de edição por IA, tendências →
conteúdo) usam o editor.

## 1. Auditoria (antes)

| Ponto | Situação encontrada |
|---|---|
| Biblioteca de canvas | Fabric.js 7.4 (MIT), carregado só no navegador. |
| Formato salvo | A cena do Fabric (`canvas.toObject`) em `designs.document` (jsonb): `{ version, objects, background }`, **uma página**, tamanho nas colunas `width`/`height`. |
| Objetos | Textbox, Rect, Circle, Triangle, Line e Image, com escala/ângulo/origem do Fabric (origem padrão no centro no Fabric 7). Sem grupos, componentes, guias, páginas. |
| Imagens | Enviadas para Arquivos (`/api/uploads`) e referenciadas por `src: "/api/files/<versão>"` — a detecção de uso em `files.ts` procura esse texto no documento. |
| Desfazer | Pilha de 60 cópias JSON da cena inteira. |
| Exportação | `toDataURL` da tela (PNG/JPG) e envio para Arquivos como nova versão do arquivo da arte. Sem PDF. |
| Salvamento | Já usava a nuvem central da Frente G: `useAutosave`, rascunho local, conflito por revisão, versões (`design_versions`). |
| Limitações | Página única; o canvas encolhia para caber na tela (sem área de trabalho, zoom limitado); "centralizar" usava o centro da tela, não da arte; sem réguas, guias, grade, alinhamento magnético, seleção múltipla com alinhamento, camadas agrupáveis, componentes, cortes de imagem ou degradês; controles mudavam o objeto do Fabric direto (sem histórico confiável). |

## 2. Decisões

1. **O documento é a fonte da verdade; o Fabric só desenha.** O documento
   novo (`aragonez.design/2`, validado com zod) guarda medidas finais (sem
   escala), e toda alteração — mouse, painel, atalho, servidor, chat — é uma
   lista de **operações** com diff legível e inversa exata.
2. **Um canvas com todas as páginas lado a lado** (Fabric continua, sem nova
   dependência). Carrossel = páginas conectadas (sem espaço entre elas): um
   elemento que passa da borda de um slide aparece no seguinte, no editor e na
   exportação.
3. **Grupos sem transformação própria**: filhos ficam em coordenadas da página
   e o grupo é a caixa que os envolve. Girar/redimensionar um grupo é aplicado
   aos filhos. Simplifica a edição, o diff e o chat.
4. **Migração na leitura**, determinística e sem perda: o banco só muda
   quando o editor salva; na primeira gravação, o documento antigo fica como
   versão nomeada ("Formato anterior (antes do novo editor)").
5. **Salvamento sem mecanismo novo**: o autosave, o rascunho local, o conflito
   por revisão e as versões da Frente G continuam os mesmos; o editor só
   entrega o documento novo.
6. **PDF sem dependência**: um gerador mínimo (`lib/design-doc/pdf.ts`, ~100
   linhas) monta um PDF com uma imagem JPEG por página. Evita trazer uma
   biblioteca grande para um caso simples; o texto do PDF é imagem (não
   selecionável) — documentado como limitação.
7. **ZIP sem dependência** (`lib/zip.ts`, método "store") para baixar várias
   páginas de uma vez.
8. **Ícones**: Lucide (ISC, já no projeto) convertidos em caminhos editáveis.

## 3. Formato do documento (`src/lib/design-doc/schema.ts`)

```ts
{
  schema: "aragonez.design/2",
  pages: [{ id, name, width, height, background, objects: DesignObject[], guides?: { v: number[], h: number[] } }],
  components: [{ id, name, width, height, objects }],
  styles?: { colors?: [...], text?: [...] },
  meta?: { preset?, carousel?, outputs?: { [pageId]: fileId }, pdfOutputFileId?, migratedFrom?, legacy? }
}
```

Objeto (todos): `id, name, x, y, width, height, rotation, opacity, locked?,
hidden?, flipX?, flipY?, shadow?`. `x`/`y` = canto superior esquerdo da caixa
sem rotação; a rotação gira em torno do centro. Tipos:

| Tipo | Campos próprios |
|---|---|
| `text` | `text, fontFamily, fontSize, fontWeight, fontStyle, textAlign, lineHeight, letterSpacing (milésimos de em), color (cor ou degradê), underline?, linethrough?, stroke?, strokeWidth?, background?, autoWidth?` — altura medida no editor |
| `image` | `src ("/api/files/<versão>"), naturalWidth?, naturalHeight?, crop? {x,y,width,height}, radius?, stroke?` |
| `rect` / `ellipse` / `triangle` / `polygon` | `fill (cor, degradê linear/radial ou null), stroke?, strokeWidth?, strokeDash?`; `radius?` (rect); `sides`, `innerRatio?` (polígono/estrela) |
| `line` | `stroke, strokeWidth, strokeDash?, lineCap?` (vai do meio da borda esquerda ao da direita) |
| `path` | `d` (SVG), `viewBox`, cores — desenho livre e ícones |
| `group` | `children` |
| `instance` | `componentId, overrides? { [idDoFilho]: { text?, src?, color?, fill?, hidden? } }` |
| `fabric` | `raw`: objeto antigo sem equivalente exato, desenhado como era |

Separação pedida em 1.3: documento/páginas, objetos, assets (arquivos de
Arquivos referenciados por `src`; `assetsOf(doc)` lista), componentes,
histórico (operações no editor + `design_versions` no servidor) e estado da
interface (seleção, página ativa, ferramenta, zoom, grade — `EditorStore`,
nunca salvo).

### Migração do formato antigo (`legacy.ts`, `read.ts`)

`readDesignDocument(raw, { width, height })` aceita qualquer formato:
- formato 2 válido → como está; com partes inválidas → as partes válidas e o
  resto em `meta.legacy.invalid` (nada se perde);
- cena antiga → uma página: centro calculado como o Fabric (origem, contorno,
  ângulo), escala incorporada a largura/altura/fonte, `charSpacing` →
  `letterSpacing`, recorte de imagem, linhas por pontas, círculos → elipses,
  grupos → grupos com filhos na página, propriedades sem equivalente em
  `legacy`; objetos inclinados, com filtro/recorte, caminhos e polígonos
  ficam como `fabric` (intactos). Testado contra medidas do próprio Fabric
  (`tests/fixtures/legacy-fabric.json`).

## 4. Camada de operações (`src/lib/design-doc/ops.ts`)

```ts
const r = applyOperations(doc, ops);   // lote atômico; lança DesignOpError(index)
r.doc       // novo documento (objetos intactos mantêm a referência)
r.diffs     // [{ op, summary: "Título “A”: texto “A” → “B”", targets, changes: [{ id, field, before, after }] }]
r.inverse   // operações que desfazem o lote
r.applied   // operações com ids gerados preenchidos (refazer determinístico)
```

Operações: `add`, `remove`, `update` (com `unset`), `replace`, `setText`,
`setStyle` (aplica só o que cada tipo aceita; `fill` em texto = cor),
`transform`, `move`, `resize`, `replaceImage` (mantém a caixa; preencher,
encaixar ou esticar), `imageFit` (zoom/foco do recorte), `crop`, `duplicate`,
`reorder`, `reparent`, `group`, `ungroup`, `restoreList`, `align`,
`distribute`, `addPage`, `removePage`, `updatePage`, `replacePage`,
`reorderPage`, `duplicatePage`, `changePalette` (por página ou na arte toda),
`setMeta`, `replaceMeta`, `addComponent`, `removeComponent`,
`replaceComponent`, `createComponent`, `detachInstance`, `overrideInstance`,
`setStyles`.

Busca e contexto (`query.ts`): `findObjects(doc, { page, type, name,
textContains, ids })`, `findPage(doc, número|id|nome)`, `locate`,
`summarizeDocument(doc)` (resumo compacto para o prompt), `assetsOf`,
`fontsOf`, `colorsOf`.

### Servidor

- `applyDesignOperations(s, { designId, revision, ops, checkpointLabel?, dryRun? })`
  (`applyDesignOperationsAction`): valida as operações e as imagens
  referenciadas (arquivos acessíveis e do mesmo cliente), aplica com controle
  de revisão (revisão velha → `ConflictError`, nada muda), cria versão
  nomeada antes quando `checkpointLabel` vem, e devolve `diffs`, `inverse`,
  `applied`, o documento e a nova revisão. `dryRun: true` = prévia sem gravar.
- `saveDesign` valida o formato 2 por inteiro e atualiza `width`/`height` com
  a primeira página; documentos antigos continuam aceitos (outros módulos).
- `createDesign` cria no formato 2: `preset`, `pages`, `carousel` ou
  `document` pronto (validado). Templates de um cliente só valem para artes do
  mesmo cliente; cópias não herdam os arquivos exportados.
- `compareDesignVersions` entende os dois formatos (ids estáveis casam).

### Para o chat de edição por IA (próxima frente)

1. Contexto: `getDesign` → `readDesignDocument` → `summarizeDocument` (+ a
   página/seleção que o editor informar).
2. O modelo propõe **operações** (o esquema zod `designOpSchema` serve de
   contrato); o servidor chama `applyDesignOperations` com `dryRun: true` e
   mostra `diffs` (antes/depois) para a pessoa aceitar.
3. Ao aceitar: mesma chamada sem `dryRun`, com `checkpointLabel: "Antes da
   edição pelo chat"`. Desfazer = aplicar `inverse` (também com revisão).
4. Imagens novas/editadas pelo provedor entram em Arquivos e na operação
   `replaceImage` (o servidor recusa arquivo de outro cliente).
5. Editor aberto ao mesmo tempo: o próximo salvamento dele acusa conflito
   (fluxo existente). Melhoria futura: o editor aplicar as operações do chat
   ao vivo.

### Para a Frente H (tendências → conteúdo)

Integrado: `createFromTrend` (src/server/services/content.ts) gera as artes já
no formato 2 (`buildDesignDocument`), e o carrossel é **um** design com uma
página por slide (`meta.carousel`), com a imagem recortada para cobrir a página
sem sobrar para o slide vizinho. Padrão usado:

```ts
import { createDocument, textObject, imageObject, fileSrc } from "@/lib/design-doc";
const document = createDocument({
  carousel: true,
  preset: "carousel-portrait",
  pages: slides.map((s) => ({ width: 1080, height: 1350, background: brand.bg, objects: [textObject({ ... }), ...] })),
});
await createDesign(s, { name, width: 1080, height: 1350, clientId, projectId, document });
```

## 5. Interface

- **Barra superior**: nome, estado do salvamento, desfazer/refazer,
  histórico de versões, zoom e visualização (réguas, grade, magnético),
  Exportar, mais ações (duplicar, salvar como template, abrir o arquivo
  exportado para aprovação/portal, atalhos) e Enviar para Arquivos.
- **Painel esquerdo** (trilho de ícones): Adicionar (textos, formas, linha,
  ícones, imagem), Camadas (páginas/slides com reordenação e camadas em
  árvore com ordem por arraste, ocultar, bloquear, renomear), Marca (cores,
  fontes, estilos de texto, troca de paleta), Imagens (de Arquivos, do
  cliente ou todas), Componentes, Modelos (inserir páginas de templates).
- **Canvas** central com área de trabalho, páginas lado a lado, nomes das
  páginas, réguas (arraste cria guias), grade, alinhamento magnético com
  linhas, menu de contexto e barra de ferramentas flutuante embaixo
  (selecionar, mão, texto, retângulo, elipse, linha, desenho, imagem,
  componentes).
- **Painel direito** contextual (página, texto, forma, linha, imagem, grupo,
  componente, vários elementos).
- **Celular**: o canvas ocupa a tela; painéis em gavetas (Adicionar, Marca,
  Editar, Camadas, Imagem); pinça para zoom; sem rolagem lateral. Entre 1024 e
  1280 px o painel de propriedades vira gaveta.

## 6. Desempenho

Redesenho incremental (objetos comparados por referência), operações em lote,
autosave agrupando alterações (1,2 s sem mudanças / no máximo 10 s), formas e
textos sem cache de bitmap e pranchetas sem sombra desfocada. Medido em
navegador sem aceleração de vídeo, 1.500 objetos em 3 páginas: montar 0,9 s,
cada alteração ~65 ms, quadro completo ~30 ms.

## 7. Gerar imagem (IA dentro do editor)

Painel **Gerar imagem** (trilho da barra lateral; botões na seção Imagens de
Fotos e Adicionar; "Gerar com IA" nas propriedades de uma imagem; gaveta no
celular). Estado em `ImageGenStore` (`editor/image-generator.tsx`), criado
junto com o editor: fechar o painel não perde descrição, opções nem
resultados, e uma geração em andamento continua.

| Camada | Onde | O que faz |
|---|---|---|
| Regras puras | `src/lib/image-gen.ts` | Formatos (1:1, 4:5, 9:16, 16:9, slide, personalizado), estilos (texto no prompt), opções por provedor (**só** o que a API oficial aceita: OpenAI `size`, `quality`, `n`; sem prompt negativo), tamanho pedido ao provedor e recorte central para a proporção exata, `buildImagePrompt`, `insertImageOps` (elemento centralizado em 80 % da página, fundo cobrindo a página com recorte "preencher", ou `replaceImage` mantendo a caixa). |
| Serviço | `src/server/services/design-image-gen.ts` | `prepareDesignImageGeneration` (permissões `designs.write` + `files.write`, seletor universal módulo `editor` / tarefa `image_generation`, opções validadas contra o provedor, contexto do slide ou do carrossel só com a política de dados de clientes, confirmação de custo), `saveDesignImageGeneration` (recorte com sharp, `storeUpload` com cliente/projeto da arte, origem `ai`, tags `ia`/`estudio`, nota com descrição e modelo; `ai_usage` + `ai_generations` kind `image_generate` com `designId`), `enhanceImagePrompt` (modelo de texto escolhido pela pessoa no painel — seletor próprio da tarefa `image_prompt`, com padrão salvável; preserva a intenção; demonstração local determinística; modelo incompatível devolve alternativas), `listGeneratedImages` (biblioteca de geradas do cliente da arte). |
| Rota | `POST /api/designs/ai/generate-image` | Mesmo contrato de erros do chat: `409 cost_confirmation`, `422 model_selection` (com alternativas), `4xx` de domínio, `502/429 provider_error` (com `retryable`); cancelável pelo `AbortSignal`. |
| Ações | `src/server/actions/design-image-gen.ts` | `enhanceImagePromptAction`, `generatedImagesAction` (o painel reaproveita `designAiSetupAction` para o seletor de modelos). |

Inserção: sempre na **página ativa no momento do clique** (nunca na página de
quando a imagem foi gerada), por `store.dispatch` — entra no desfazer e no
salvamento automático como qualquer imagem; `src` é `/api/files/<versão>`.
Nenhum modelo é inventado: a lista vem de `GET /v1/models` da conta (os
`gpt-image-*` que a chave tiver). A demonstração local não gera imagens.

## 8. Limitações conhecidas

- PDF com páginas em imagem (JPEG), sem texto selecionável.
- Estilos por caractere (negrito em parte do texto) não são editáveis; os de
  documentos antigos são mantidos até o texto ser trocado.
- Objetos antigos do tipo `fabric` (caminhos, polígonos, inclinados) só se
  movem/ocultam/excluem.
- Fontes vêm do Google Fonts no navegador; sem acesso, usa a alternativa
  (sem serifa/serifa) — a exportação reflete o que foi desenhado.
- Edição simultânea: o segundo a salvar resolve o conflito (fluxo da nuvem).
