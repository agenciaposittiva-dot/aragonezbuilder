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
