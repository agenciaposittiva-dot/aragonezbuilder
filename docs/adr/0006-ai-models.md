# ADR 0006 — Seletor universal de IA e gerenciamento de modelos

**Status:** aceita · 18/10/2026 · complementa a [ADR 0005](0005-ai.md)

## Contexto
A ADR 0005 previa um provedor por organização (com a demonstração como reserva
automática quando faltava chave). Os módulos novos (copiloto, editor, tendências,
artes) precisam escolher modelos por tarefa — texto, saída estruturada, leitura de
imagens, geração de imagens — com credenciais validadas, preferências e custos
rastreáveis.

## Decisão

### Registro de provedores (`src/server/ai/registry.ts`)
- Cada integração declara tipos de modelo (`text`/`image`), parâmetros enviados,
  limites/observações e como **listar os modelos pela API oficial** do provedor:
  - Anthropic: `GET /v1/models` pelo SDK oficial (capacidades `image_input`,
    `structured_outputs`, `effort`, ciclo de vida e linha do modelo vêm da API).
  - OpenAI: `GET /v1/models` (só ids). Texto: `gpt-*`, `chatgpt-*`, `o*` sem
    variantes de áudio/embedding/etc.; leitura de imagens e JSON ficam
    **"não confirmados"**. Imagem: `gpt-image-*`/`chatgpt-image-*` (Images API).
  - Gemini: `GET v1beta/models` (métodos suportados e limites de tokens).
- Nenhum nome de modelo é inventado: a lista exibida é a que a API devolveu para a
  chave. Capacidade sem confirmação = `unknown` (permitida com aviso).
- Tarefas (`src/lib/ai-tasks.ts`) exigem capacidades; a compatibilidade é calculada
  no servidor e na interface com as mesmas regras.

### Credenciais (`ai_provider_configs`)
- Chave da organização criptografada (AES-256-GCM) ou chave do servidor (variável de
  ambiente); a da organização tem prioridade. O navegador só recebe o final
  mascarado (`••••1234`), e só para administradores (`ai.settings`).
- Uma chave nova só é guardada depois de uma chamada real de listagem de modelos;
  chave recusada não substitui a atual. Habilitar exige validação bem-sucedida.
- Chaves do servidor e chaves migradas são validadas no primeiro uso; a lista de
  modelos fica em cache por 24 h (erros temporários são revalidados em 10 min).
- **Sem provedor, a IA fica "não configurada"**: não existe mais reserva silenciosa
  para respostas simuladas. A demonstração local só funciona quando ativada (pela
  organização ou por `AI_DEFAULT_PROVIDER=demo` no servidor) e é sempre identificada.

### Preferências (`ai_model_preferences`) e escolha
- Precedência: escolha explícita da operação → pessoa + tarefa → pessoa + módulo →
  pessoa → organização + tarefa → organização + módulo → organização → automático.
- Padrões gerais/de módulo de outro tipo (ex.: modelo de texto) são ignorados em
  tarefas de imagem; padrões definidos para a tarefa sempre valem.
- Modelo indisponível ou incompatível → `ModelSelectionError` (HTTP 422) com motivo e
  até seis alternativas compatíveis. **Nunca há troca silenciosa**: a interface pede
  que a pessoa escolha uma alternativa. Se o provedor responder com outro modelo
  (fallback da Anthropic após recusa), o modelo real é registrado e exibido.
- Escolha automática: prefere capacidades confirmadas; depois a prioridade
  (equilíbrio, qualidade, rapidez, menor custo — por preço de tabela quando existe,
  senão pela classificação do modelo); empate: o mais recente. A explicação acompanha
  a escolha.

### Execução, custos e histórico
- `runGeneration`/`runImage` (`src/server/services/ai-run.ts`) só registram sucesso
  (uso + histórico + arquivo) com conteúdo válido; qualquer falha vira `status =
  error`, com os tokens consumidos quando o provedor informa.
- `ai_usage` ganhou projeto, módulo, tarefa e origem da escolha; `cost_micros` passou
  a aceitar `NULL` = **custo não informado** (sem tabela de preço, nada é estimado).
- Política: limite mensal de custo e confirmação acima de um valor estimado; imagens
  (sem preço informado) pedem confirmação quando o aviso de custo está ativo.
- Geração de imagens: só a Images API da OpenAI (modelos `gpt-image-*`, PNG em
  base64) — contrato confirmado nos tipos do SDK oficial. Gemini imagem não está
  integrado. A imagem vai para a Central de Arquivos (`source = "ai"`) quando a pessoa
  pode enviar arquivos. Só a descrição digitada é enviada ao provedor.

### Migração 0005
Cria as tabelas (com RLS da organização), estende `ai_usage` e leva as chaves já
salvas em `organizations.settings.ai.keys` (continuam criptografadas, "não
verificadas"), a demonstração de quem a usava e o padrão da organização quando havia
uma escolha concreta (modelo, chave própria ou demonstração).

## Consequências
- Organizações sem padrão passam a usar a escolha automática (prioridade
  "equilíbrio") entre os provedores com chave válida.
- Validar uma chave faz uma chamada de rede ao provedor; páginas de IA podem levar até
  20 s na primeira validação de uma chave do servidor.
- Preços de tabela existem só para os modelos Claude atuais (`src/server/ai/pricing.ts`);
  os demais aparecem como "custo não informado" até que haja dados confiáveis.
