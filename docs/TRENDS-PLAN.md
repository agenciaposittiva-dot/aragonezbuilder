# Radar de Tendências — auditoria e plano

Módulo 3 do pedido “Evolução da plataforma” e as partes dos Módulos 4–6 que
não dependem da reformulação do editor. Decisões de arquitetura em
[ADR 0008](adr/0008-trends.md).

## 1. Auditoria (o que já existia)

| Área | Situação encontrada | Uso no Radar |
| --- | --- | --- |
| IA | Seletor universal (`resolveSelection`), tarefas em `src/lib/ai-tasks.ts` (já com `trend_analysis` e o módulo `trends`), política da organização (`assertCanGenerate`, `allowClientContext`, confirmação de custo), registro de uso e histórico | Classificação, adequação por cliente e pacote de conteúdo usam as tarefas `trend_analysis` e `copy` no módulo `trends` |
| Imagens | `prepareImage` + `runImage` salvam o PNG em Arquivos | Imagem principal do conteúdo |
| Editor | `createDesign` + `saveDesign` (documento Fabric 7.4) | Artes editáveis criadas só por esses serviços — o editor não foi alterado |
| Tarefas / Solicitações | `createTask`, `createRequest` | Tarefa de produção e briefing em rascunho, com confirmação |
| Marca | `brand_profiles`, `client_services` | Contexto da marca nas perguntas por cliente |
| Rotinas | `/api/cron/tick` (diário na Vercel) e worker pg-boss | Coleta automática das fontes vencidas |
| Campanhas / peças / calendário editorial | **Não existiam** | Criadas como entidades base compartilhadas (ADR 0008) |

Restrições do ambiente de desenvolvimento: os hosts das fontes não são
alcançáveis daqui. Os conectores são funções puras de leitura + um `fetch`
protegido; os testes usam respostas gravadas em `tests/fixtures/trends/`
(formato real, conteúdo fictício, marcadas como fixture). Em produção, a
tela **Radar › Fontes** mostra o estado real de cada fonte e tem
“Testar agora”.

## 2. Fontes (só conectores legítimos)

Interface comum (`src/server/trends/connectors/types.ts`): disponibilidade,
documentação (endpoint, termos, limites, custo, atualização, indicadores),
coleta idempotente por **fonte + id externo**, último sucesso/erro e cache
por rodada (a mesma fonte usada por várias agências é buscada uma vez).

| Fonte | Endpoint | Termos | Limites | Custo | Indicadores |
| --- | --- | --- | --- | --- | --- |
| Google Trends | `https://trends.google.com/trending/rss?geo=BR` | Feed RSS público do próprio Google Trends; sem chave; Termos de Serviço do Google | Sem limite documentado; o Radar consulta a cada 6 h e, à mão, no máximo a cada 15 min | Gratuito | “Tráfego aproximado” **exatamente como informado** (ex.: `2000+`) |
| Wikimedia | `https://wikimedia.org/api/rest_v1/metrics/pageviews/top/pt.wikipedia/all-access/AAAA/MM/DD` | API pública da Wikimedia (dados CC0); exige User-Agent identificável (enviado) | 100 req/s; o Radar faz 1–2 por coleta | Gratuito | Visualizações reais do dia e posição; **atraso de 1 dia**, com a data em cada indicador |
| YouTube Data API v3 | `videos.list?chart=mostPopular&regionCode=BR` | API oficial; chave `YOUTUBE_API_KEY` só no servidor | 10.000 unidades/dia; 1 unidade por consulta | Gratuito na cota | Visualizações, curtidas e comentários quando o YouTube informa |
| RSS / Atom | informado pela agência (por organização e nicho) | Só feeds oferecidos pelo veículo; guardamos título, resumo curto e link | Do veículo; mesma cadência acima | Gratuito | Nenhum (notícia não é popularidade) |
| Datas comemorativas | calculado no servidor (`br-dates.ts`) | Lei 10.607/2002, Lei 6.802/1980, Lei 14.759/2023, ONU/OMS/UNESCO/FAO, varejo, tradição popular — fonte citada em cada data | Sem rede | Gratuito | Nenhum (datas fixas e móveis: Carnaval, Sexta-feira Santa, Páscoa, Corpus Christi, Dia das Mães/Pais, Black Friday, Cyber Monday) |

Não há scraping de sites, redes sociais ou páginas do Google. Instagram e
TikTok não têm API pública de tendências e ficaram fora (sem simulação).

Proteções do `fetch`: tempo limite de 8 s, 2 MB, User-Agent identificável,
redirecionamentos validados um a um, recusa de credenciais na URL e de hosts
que resolvem para rede interna (SSRF), leitor de XML que descarta DOCTYPE e
nunca expande entidades.

Atualização: rotina (`runDueSchedules` no cron diário e `cron-trends-refresh`
a cada 6 h no worker) com orçamento de tempo e retomada — fontes que não
couberem ficam para a próxima rodada; trava por fonte (`running_since`, 5 min)
evita coletas simultâneas; o botão “Atualizar” respeita 15 min por fonte. A
rede nunca é chamada dentro de transação.

## 3. Modelo de dados

- `trend_sources` — fontes da organização (padrão + RSS), estado da última coleta.
- `trends` — item observado; único por `(organização, fonte, id externo)`; `metrics` e `related` exatamente como a fonte informou.
- `trend_observations` — uma linha por tendência e dia (posição e indicadores), base da **evidência de crescimento**.
- `trend_analyses` — inferências da IA (`classification` ou `client_fit` por cliente), com `guardrails`, provedor, modelo e se foi demonstração.
- `trend_user_states` — salvar, favoritar, acompanhar, descartar (por pessoa).
- `trend_collections` / `trend_collection_items` — coleções da equipe.
- `campaigns`, `content_items`, `content_item_assets` — entidades base de conteúdo (ADR 0008).

Todas com `organization_id` e RLS FORCE aplicada pelo `scripts/migrate.ts`.

## 4. Regras da IA (aplicadas depois da resposta)

1. A IA recebe só os dados observados; o resultado vai para `trend_analyses`, nunca altera `trends`.
2. Números que não estão nos dados da fonte são substituídos por “[número sem respaldo na fonte]”.
3. “Em crescimento” exige duas coletas com subida medida; sem isso vira “emergente”.
4. Datas do calendário são sempre “sazonais”.
5. Sem indicadores na fonte, a confiança não passa de “média”.
6. Risco de reputação alto nunca é recomendado para um cliente; o pacote de conteúdo é recusado quando a última análise da marca não recomenda o tema.
7. Identificadores que não estavam na lista enviada são descartados.
8. Política da organização: IA habilitada, limites, autorização para dados de clientes (perguntas por cliente exigem) e confirmação de custo.
9. Falha do provedor ou resposta fora do formato é registrada como erro; nada é salvo como sucesso.
10. A palavra “viral” é proibida no prompt de conteúdo; notícia não é evidência de viralização.

Na interface, cada card separa **observado** (fonte, números, datas) e
**inferido** (borda tracejada, “Inferência da IA”/“demonstração”).

## 5. Etapas

1. Esquema, permissões e migração temporária — **feito**.
2. Conectores + calendário + `fetch` seguro — **feito** (testes com fixtures).
3. Serviço de coleta, consulta, filtros, estados e coleções — **feito**.
4. IA: classificação, por cliente, pacote de conteúdo — **feito**.
5. Conteúdo: campanhas, peças, artes no editor atual, briefing, tarefa, calendário editorial e envio para aprovação — **feito**.
6. Telas: Radar, detalhe, Fontes, Conteúdos (lista, mês, semana) e peça — **feito**.
7. Testes unitários/integração e e2e (desktop e celular) — **feito**.

Pendências conhecidas: validar as fontes reais em produção com “Testar
agora”; definir `YOUTUBE_API_KEY`; gerar a migração definitiva no branch de
integração (o SQL está no relatório da Frente H).
