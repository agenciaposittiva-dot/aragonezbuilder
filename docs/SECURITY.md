# Segurança

## Autenticação e sessão
- Better Auth: senha com hash scrypt, mínimo de 8 caracteres, sessões em banco
  (7 dias, renovadas diariamente), **sem cache em cookie** — revogar uma sessão ou
  remover um vínculo vale na próxima requisição.
- Redefinição de senha com token de 1 hora e encerramento das demais sessões.
- Resposta idêntica para e-mails existentes e inexistentes na recuperação de senha.
- Limite de tentativas em produção (login, cadastro e recuperação), armazenado no banco.
- Convites: token aleatório de 32 bytes; o banco guarda só o hash SHA-256; validade de
  7 dias; aceite exige o mesmo e-mail do convite.

## Autorização
- Verificada no servidor em toda operação (serviços), nunca apenas escondendo botões.
- Permissões por papel, editáveis por organização (o Proprietário é imutável).
- Escopo de dados por ator (`src/server/authz/index.ts`) + RLS no banco
  (ver `docs/adr/0003-multitenancy.md`).
- Usuários de cliente nunca recebem: comentários internos, tarefas internas, custos,
  custo/hora, orçamento, observações internas, contatos internos, arquivos não
  compartilhados.

## Server Actions e rotas
- Server Actions: verificação de origem (CSRF) do Next.js, validação Zod, ator
  resolvido a cada chamada, erros de domínio convertidos em mensagens sem vazar detalhes.
- Route Handlers que alteram dados verificam `Origin` (`src/server/http.ts`).
- Cabeçalhos: `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `X-Frame-Options`,
  `Permissions-Policy`; sem `X-Powered-By`.

## Arquivos
- Bucket/pasta privada; download só por URL assinada de curta duração após checar o
  escopo do ator.
- Tipo real do arquivo identificado pelos bytes (não pela extensão) e tamanho validado
  no servidor contra o limite da organização.
- SVG/HTML sempre baixados como anexo, com `Content-Security-Policy: sandbox`.

## IA
- Dados de clientes só são enviados ao provedor com autorização da organização.
- Chaves de API criptografadas (AES-256-GCM). Registro completo de uso.
- Sem execução de código ou acesso direto ao banco pelo modelo.

### Chaves de IA pessoais (BYOK)
- Tabela `ai_user_connections` (por organização e pessoa, RLS forçado): a chave
  é validada numa chamada real ao provedor antes de ser gravada, criptografada
  com `encryptSecret` (AES-256-GCM, `src/server/crypto.ts`); uma chave
  recusada nunca substitui a atual.
- Nunca volta ao navegador: as telas recebem só o final mascarado (`••••a1b2`);
  erros, respostas de ações e `audit_logs` guardam apenas o provedor.
- Isolamento: `listMyConnections`/`saveMyConnection`/`testMyConnection`/
  `removeMyConnection` filtram por `userId` do ator dentro do escopo da
  organização; outra pessoa (ou outra organização) não enxerga nem usa a chave.
- Precedência: chave pessoal válida e ativa > chave da organização > chave do
  servidor. A origem fica registrada em `ai_usage.key_source` (`user`, `org`,
  `env`) para separar o consumo.
- Política: `settings.ai.allowPersonalKeys` (geral) e
  `ai_provider_configs.allow_user_keys` (por provedor); bloqueadas, as chaves
  pessoais deixam de ser usadas e não podem ser cadastradas/reativadas.
- Endereço personalizado (só OpenAI e Magnific, gateways compatíveis): HTTPS
  obrigatório, sem credenciais na URL, porta padrão, nomes/IPs internos e
  nomes que resolvem para faixas privadas são recusados (`src/lib/endpoint-url.ts`
  + verificação de DNS em `validateEndpointUrl`).
- Limite de 10 validações por pessoa a cada 10 minutos (por processo).

### Chave mestra de criptografia e rotação
- `ENCRYPTION_KEY` (32 bytes em base64) cifra as chaves de IA da organização e
  as pessoais. Sem ela, usa-se uma chave derivada de `BETTER_AUTH_SECRET`.
- Para gerar: `openssl rand -base64 32`.
- Rotação: esta versão não lê duas chaves mestras ao mesmo tempo. Procedimento
  suportado: avisar as agências e pessoas, trocar `ENCRYPTION_KEY` no servidor
  e pedir que cadastrem as chaves de IA de novo — as linhas antigas deixam de
  abrir ("não foi possível ler a chave guardada") e a próxima validação as
  marca como erro até a chave ser informada outra vez. Registre a troca no
  diário de operação. Quem precisar de rotação sem recadastro deve implementar
  leitura com a chave anterior (`ENCRYPTION_KEY_PREVIOUS`) e recifragem em
  lote antes de ativar o recurso em produção.

## Webhooks de automação
- HTTPS obrigatório (exceto em desenvolvimento), assinatura HMAC, tempo limite e
  bloqueio de endereços privados/loopback/metadados (proteção contra SSRF).

## Auditoria
- `audit_logs` registra quem fez o quê, quando, e o que mudou (diferença de campos),
  na mesma transação da operação.

## LGPD
- Dados pessoais tratados: nome, e-mail, telefone de usuários e contatos de clientes.
- Recomenda-se: contrato de operador com os clientes da agência, política de
  privacidade, base legal para o envio de dados ao provedor de IA (por isso o envio é
  desligado por padrão) e procedimento de exclusão sob demanda.
