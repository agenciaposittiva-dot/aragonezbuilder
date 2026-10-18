# ADR 0008 — Radar de Tendências e entidades base de conteúdo

Status: aceito · Data: 2026-10

## Contexto

O Radar precisa juntar assuntos em alta de fontes públicas, deixar a IA
interpretar sem misturar inferência com dado observado e transformar uma
tendência em conteúdo de um cliente (texto, artes, briefing, tarefa,
calendário, aprovação). A Central de Pré-visualização e a Máquina de
Conteúdo, que virão depois, precisam das mesmas noções de campanha e peça.

## Decisões

1. **Tendências por organização**, não globais. Cada agência tem suas fontes
   (as padrão são criadas sob demanda e as RSS são dela), seus estados e suas
   análises. Mantém o modelo de RLS existente (`organization_id` + FORCE) sem
   exceções. Para não repetir requisições, a rotina usa um **cache por
   rodada**: a mesma fonte com a mesma configuração (ex.: Google Trends BR) é
   buscada uma vez e gravada em todas as agências.
2. **Observado × inferido em tabelas separadas.** `trends` e
   `trend_observations` guardam só o que a fonte devolveu; `trend_analyses`
   guarda as inferências (com `guardrails`, provedor, modelo, demonstração).
   A IA nunca escreve em `trends`.
3. **Idempotência** por `(organização, fonte, id externo)` e uma observação
   por tendência e dia. Repetir uma coleta atualiza, não duplica.
4. **Rede fora de transação e com trava por fonte** (`running_since`, expira
   em 5 min). O cron tem orçamento de tempo; o que não couber fica para a
   próxima rodada (retomada natural, sem fila extra).
5. **Segredos só no servidor.** A chave do YouTube é `YOUTUBE_API_KEY`; a
   configuração da fonte no banco nunca a contém.
6. **Entidades base de conteúdo compartilhadas**:
   - `campaigns` (cliente, nome, objetivo, período);
   - `content_items` (cliente obrigatório; vínculos opcionais a campanha,
     projeto, tendência, análise, tarefa e solicitação; formato, status,
     textos, páginas do carrossel, data planejada);
   - `content_item_assets` (peça → arte do editor ou arquivo, com papel e
     posição).
   A peça **aponta** para os registros existentes (artes, arquivos, tarefa,
   briefing) — nada é copiado. O calendário editorial é a consulta por
   `planned_date` (mês e semana). As FKs opcionais são `ON DELETE SET NULL`
   para não travar a lixeira existente; campanha e peça caem junto com o
   cliente (`CASCADE`).
7. **Artes pelo editor atual**: a cadeia “Criar conteúdo” usa só
   `createDesign` + `saveDesign` (documento Fabric 7.4 com camadas separadas,
   fonte e cores da marca, imagem referenciada por `/api/files/<versão>`).
   Feed 1080×1350, Stories 1080×1920, carrossel = uma arte por página.
8. **Prévia e confirmação**: a IA prepara uma prévia editável; nada é criado
   até a confirmação, e a criação inteira roda numa única transação (ou tudo
   ou nada). Imagem é uma etapa à parte e opcional; falha do provedor é
   mostrada como falha.
9. **Permissões novas**: `trends.read`, `trends.manage`, `content.read`,
   `content.write` — todas só internas (o portal do cliente não vê nada).

## Consequências

- A Pré-visualização e a Máquina de Conteúdo reutilizam `content_items`
  (status, data, artes vinculadas) sem nova modelagem.
- A mesma tendência pode existir em várias agências (uma linha por agência);
  é o custo de manter o isolamento simples.
- Fontes sem API pública de tendências (Instagram, TikTok) ficam de fora até
  existir integração oficial.
