# Máquina de Conteúdo — plano e estado

Assistente guiado que transforma uma oportunidade de conteúdo em uma peça
pronta para revisão: cliente → assunto → ângulo → formato → geração → visual →
editor → prévia → aprovação e calendário. **Não é um módulo paralelo**: cada
etapa usa o que a plataforma já tem.

## Fase 1: o que é reaproveitado

| Etapa | Peça existente | Onde |
| --- | --- | --- |
| Cliente e marca | Cadastro de clientes + perfil da marca (`brand_profiles`); privacidade "dados de clientes" (Configurações → IA) | `services/clients.ts`, `carousel-generator.ts#loadClient` |
| Assunto em alta | Radar de Tendências: fontes verificáveis (Google Trends, Wikipédia, YouTube, RSS, datas), observações com data e posição, análise por cliente | `services/trends.ts`, `trends-ai.ts`, `server/trends/connectors` |
| Link informado | Busca segura (sem rede interna, tempo e tamanho limitados, redirecionamentos validados) | `server/trends/connectors/index.ts#fetchText` |
| Arquivo informado | Arquivos da plataforma (permissão e cliente verificados) | `services/files.ts` |
| IA por etapa | Seletor universal (modo automático, escolha explícita nunca trocada em silêncio, uso e erro registrados, chaves só no servidor) | `ai-models.ts`, `ai-structured.ts`, `components/ai/ai-model-picker.tsx` |
| Carrossel | Gerador de carrosséis (roteiro narrativo, regra de números, direção de arte pela identidade, imagens por IA salvas em Arquivos, texto editável) | `services/carousel-generator.ts`, `lib/carousel-gen` |
| Revisão | Editor (regenerar um slide, nova direção visual, segunda versão, versões, chat de edição por IA) | `components/studio/editor`, `design-ai*.ts` |
| Prévia | Central de pré-visualização (feed, carrossel, stories, verificações, aprovação) | `services/content-preview.ts`, `components/preview` |
| Planejamento | Peças de conteúdo + calendário editorial, tarefas, aprovações, portal | `services/content.ts`, `tasks.ts`, `approvals.ts` |
| Exportação | Exportar página a página e pacote ZIP com todos os slides | `components/studio/editor/export.ts` |

## Modelo de dados

Uma tabela nova, só aditiva: `content_machine_projects` (migração `0016`).
Guarda o projeto do assistente (etapa, fonte, oportunidade, ângulos, escolha,
formato, objetivo e as IAs de cada etapa), com `revision` para o salvamento
automático sem sobrescrever outra aba. Os resultados **não são copiados**: o
projeto aponta para a arte (`designs`) e para a peça de conteúdo
(`content_items`), que já ligam calendário, tarefa, aprovação e portal. RLS
por organização (aplicado pelo `migrate.ts` a toda tabela com
`organization_id`). Recuperação: a migração só cria a tabela e o tipo. Para
desfazer, basta remover os dois, sem tocar em dados existentes.

## Regras de verdade

- **Em alta comprovado** só quando o assunto vem do Radar com observações reais
  (data, posição ou métricas da fonte). Ideias, textos e links são
  **hipóteses editoriais**, e a tela diz isso.
- Fonte, link e data vêm dos dados coletados, nunca da IA.
- Só o texto da fonte (link, arquivo ou texto colado) e os dados do Radar
  entram como **referência** para o roteiro. O resumo escrito pela IA não
  entra. Números fora das referências viram "dados a confirmar", pela regra
  do gerador.
- Sem perfil de marca suficiente, a proposta sai marcada como **provisória**.

## Fases

| Fase | Entrega | Estado |
| --- | --- | --- |
| 1 | Análise e plano | ✅ |
| 2 | Projetos salvos e recuperáveis, assistente de 9 etapas, assunto por ideia/texto/link/arquivo/Radar, oportunidade, ângulos (escolher, editar, pedir mais), geração do carrossel com progresso real, ligação arte + peça | ✅ |
| 3 | Identidade e visual (nova direção visual, abrir no editor), prévia | ✅ |
| 4 | Pesquisa de tendências por nicho/cliente dentro da Máquina (filtros e análise do Radar) | parcial: escolher temas do Radar com evidência; botão "Criar na Máquina" no tema |
| 5 | Outros formatos (post, stories, reels, legenda, anúncio, série), exportação e aprovação | parcial: aprovação, calendário, tarefa e exportação do carrossel |
| 6 | Resultados (alcance, salvamentos…) e sugestões de experimentos | a fazer |
