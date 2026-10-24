# Google Drive por pessoa

Cada pessoa da agência pode conectar a **própria** conta Google e usar o Drive
dela como destino das exportações do Estúdio e dos envios de arquivos, e como
origem para importar imagens e documentos. A plataforma continua guardando a
cópia e os metadados próprios (biblioteca, versões, aprovações); o Drive recebe
o original exportado. Nada é migrado automaticamente.

## O que a pessoa vê

- **Meu perfil → Armazenamento e integrações**: estado da conexão, conta
  conectada (e-mail), "Testar acesso", "Renovar autorização" quando o Google
  pede, "Desconectar" (com confirmação; revoga o token no Google e apaga os
  tokens do servidor), destino preferido dos novos arquivos, organização das
  pastas (cliente / projeto / ano) e pasta padrão (entre as pastas que a
  plataforma criou — ou todo o Drive, com o escopo amplo).
- **Arquivos → Google Drive**: navegar nas pastas autorizadas, pesquisar por
  nome, importar um arquivo para a biblioteca (cliente/projeto escolhidos),
  criar pastas. Arquivos importados ficam com origem "Google Drive".
- **Arquivos → ações de um arquivo**: "Salvar no Google Drive" (envia a versão
  atual para a pasta padrão/organizada e mostra o link).
- **Estúdio → Exportar**: "Enviar para Arquivos e Google Drive" exporta as
  páginas (PNG/JPG/PDF, nos formatos já suportados), grava em Arquivos como
  sempre e envia cada arquivo ao Drive, com progresso e link no final.

## Segurança

- OAuth 2.0 no servidor, com `state` assinado (HMAC) e preso à pessoa que
  iniciou (CSRF), validade de 15 min; o retorno só é aceito com sessão ativa.
- Tokens (acesso e renovação) criptografados com AES-256-GCM
  (`src/server/crypto.ts`, `ENCRYPTION_KEY`); nunca vão ao navegador, a logs
  ou à auditoria.
- Isolamento por organização (RLS) e por pessoa (`user_id` do ator em todas
  as consultas). Outra pessoa não vê nem usa a conexão.
- Permissão `files.write` para conectar/exportar/importar; o acesso ao
  arquivo da plataforma segue as regras normais (`getVersionForDownload`).
- Tipo e tamanho validados na importação (mesmos limites do envio normal).
- Nada é compartilhado nem tornado público no Drive.

## Escopos

- Padrão: `https://www.googleapis.com/auth/drive.file` (+ `openid email`):
  a plataforma só enxerga arquivos e pastas que ela criou (ou que a pessoa
  abriu por ela). Não dá para navegar no Drive inteiro — por isso a pasta
  padrão é escolhida entre as pastas da plataforma.
- `GOOGLE_DRIVE_SCOPE=full` pede `https://www.googleapis.com/auth/drive`
  (acesso amplo, sujeito à verificação do app pelo Google). Só use se a
  agência aceitar esse escopo; a interface avisa qual está em uso.

## Configuração no Google Cloud Console

1. Crie (ou use) um projeto e ative a **Google Drive API** (APIs e serviços →
   Biblioteca).
2. **Tela de consentimento OAuth**: tipo "Externo" (ou "Interno" num Google
   Workspace), nome do app, e-mails de suporte, escopos `.../auth/drive.file`
   (ou `.../auth/drive`), `openid` e `email`. Enquanto o app estiver em
   "Teste", só os e-mails cadastrados como testadores conseguem conectar.
3. **Credenciais → ID do cliente OAuth** do tipo "Aplicativo da Web":
   - Origens JavaScript autorizadas: a URL da plataforma (ex.:
     `https://app.suaagencia.com.br`).
   - URIs de redirecionamento autorizados:
     `https://app.suaagencia.com.br/api/integrations/google-drive/callback`
     (em desenvolvimento, `http://localhost:3000/api/integrations/google-drive/callback`).
4. Variáveis de ambiente do servidor:

```
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_DRIVE_SCOPE=file   # ou full
ENCRYPTION_KEY=           # recomendado: openssl rand -base64 32
APP_URL=https://app.suaagencia.com.br
```

`APP_URL` precisa ser exatamente a origem cadastrada no Google (o
redirecionamento é montado a partir dela).

## Comportamento com falhas

- Token vencido: renovado automaticamente com o refresh token; se o Google
  responder `invalid_grant` (revogação), a conexão fica "Autorização
  necessária" e a pessoa clica em "Renovar autorização".
- `401`/`403` do Drive: mensagens claras ("autorização venceu", "sem
  espaço no Drive", "limite de chamadas"); `429`/`5xx` pedem nova tentativa.
- Exportação que falha fica registrada em `google_drive_files` com
  `status = failed` e o erro; nada é mostrado como salvo antes de o Google
  confirmar.

## Tabelas

- `google_drive_connections` (uma por pessoa e organização): conta, tokens
  criptografados, escopos, estado, pasta raiz/padrão, organização, destino.
- `google_drive_files`: cada passagem pelo Drive (export/import) com o id do
  arquivo no Drive, pasta, nome, tamanho, link, e o arquivo/versão da
  plataforma correspondente.

## Validação real

Sem `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` o fluxo real não roda: a tela
explica o que falta e os testes automatizados usam a API do Google simulada
(`tests/google-drive.test.ts`). Com credenciais, valide: conectar, testar
acesso, exportar do Estúdio, importar da biblioteca, renovar e desconectar.
