# Pacote de cliente (importação)

Um **pacote de cliente** é um arquivo `.zip` que cria, de uma vez, um cliente
completo no Aragonez Builder: cadastro, perfil da marca, biblioteca de marca
(logotipos, materiais, manual), projetos com demandas e a personalização do
portal (login e capa), já publicada.

Serve para o onboarding de um cliente novo e para levar um cliente preparado
em outro ambiente (por exemplo, montado localmente a partir do manual de
identidade no Figma) para a plataforma em produção, sem recadastrar nada.

## Como importar

1. **Clientes → Importar pacote** (precisa da permissão de criar clientes; para
   arquivos, projetos e demandas, também das permissões correspondentes).
2. Escolha o `.zip` e, se quiser, a categoria do cliente. Limite: o mesmo dos
   envios de arquivos (`UPLOAD_MAX_BYTES`; na Vercel, 4 MB por requisição).
3. Clique em **Importar**. Tudo é gravado numa única transação: se qualquer
   etapa falhar, nenhum cliente fica pela metade e o erro aparece no campo.
4. A tela abre o cliente criado. As abas Marca, Projetos e Portal já estão
   preenchidas; o link do portal fica em **Portal → Endereço e acesso**.

## Formato

O zip precisa de um `manifest.json` na raiz (ou dentro de uma única pasta, como
acontece ao compactar uma pasta inteira). Os demais arquivos são referenciados
pelo caminho relativo. Pastas `__MACOSX`, `.DS_Store` e `Thumbs.db` são ignoradas.

```json
{
  "format": "aragonez-client-package",
  "version": 1,
  "client": {
    "name": "GW Ads",
    "industry": "Tráfego pago e marketing digital",
    "category": "Clientes ativos",
    "logoBackground": "#0b0b0b"
  },
  "brand": {
    "toneOfVoice": "Direto, didático e seguro…",
    "audience": "…",
    "objectives": "…",
    "positioning": "…",
    "avoid": "…",
    "keywords": ["tráfego pago", "performance"],
    "guidelines": "…",
    "colors": [{ "name": "Preto", "hex": "#0b0b0b" }, { "name": "Verde-lima", "hex": "#c3f23a" }],
    "fonts": [{ "name": "Fraunces", "usage": "Títulos e frases de impacto" }]
  },
  "files": [
    { "path": "arquivos/gw-logo-positiva.png", "category": "brand_logo", "tags": ["logo"], "logo": true },
    { "path": "arquivos/gw-login-1920x1080.webp", "category": "brand_asset", "tags": ["portal", "login"] },
    { "path": "manual/GW-Manual-de-identidade-visual.pdf", "category": "brand_guideline" }
  ],
  "projects": [
    {
      "name": "Conteúdo Instagram — 6 posts",
      "objective": "Educar e gerar conversas no direct",
      "tasks": [{ "title": "Post 1 — A internet passou a TV", "description": "Formato: imagem estática…" }]
    }
  ],
  "portal": {
    "settings": {
      "displayName": "GW Ads",
      "colors": { "primary": "#c3f23a", "secondary": "#1c1c1c", "background": "#f2f2f2", "text": "#0b0b0b" },
      "welcomeTitle": "Estratégia que vira crescimento.",
      "login": { "layout": "card", "title": "Portal GW Ads", "message": "Entre para acompanhar…" },
      "banner": { "title": "Estratégia que vira crescimento.", "showLogo": false, "focalX": 75 }
    },
    "files": {
      "logo": "arquivos/gw-logo-login-400x160.png",
      "favicon": "arquivos/gw-favicon-256.png",
      "loginBackground": "arquivos/gw-login-1920x1080.webp",
      "banner": "arquivos/gw-capa-portal-2400x800.webp"
    },
    "access": { "loginEnabled": true, "allowGuestInvites": false },
    "publish": true
  }
}
```

### Campos

| Campo | Obrigatório | Conteúdo |
|---|---|---|
| `format`, `version` | sim | `"aragonez-client-package"` e `1`. |
| `client` | sim | Os mesmos campos do formulário **Novo cliente** (`name` obrigatório; `legalName`, `document`, `email`, `phone`, `website`, `industry`, `address`, `status`, `notesInternal`), mais `category` (nome de uma categoria já existente na agência, ex.: `"Clientes ativos"`; a escolhida no diálogo de importação tem prioridade e um nome desconhecido deixa o cliente sem categoria) e `logoBackground` (cor hex atrás do logotipo nas miniaturas, ex.: `"#0b0b0b"` para uma logo branca). |
| `brand` | não | Os campos da aba **Marca**: `toneOfVoice`, `audience`, `objectives`, `positioning`, `avoid`, `keywords[]`, `guidelines`, `colors[{name, hex, usage}]`, `fonts[{name, usage, source}]`. |
| `files[]` | não | `path` (dentro do zip), `category` (`brand_logo`, `brand_asset`, `brand_guideline`, `template`, `reference`, `document`, `deliverable`, `general`), `tags[]`, `note` e `logo: true` em **um** arquivo de imagem para virar o logotipo do cliente. Até 100 arquivos; cada um passa pela validação normal de envio (tipo real pelos bytes, tamanho, cota). |
| `projects[]` | não | `name`, `description`, `objective`, `priority` (`low`, `medium`, `high`, `urgent`) e `tasks[]` com `title`, `description`, `priority`. Até 20 projetos e 200 demandas por projeto. |
| `portal.settings` | não | Exatamente o que a tela **Portal** grava (nome, cores, textos, login, banner, links, botões, contato, seções), **sem** os ids de arquivo. |
| `portal.files` | não | Caminhos (listados em `files`) para `logo`, `logoAlt`, `favicon`, `loginBackground` e `banner`. |
| `portal.access` | não | `slug` (padrão: gerado do nome), `loginEnabled` (padrão `true`), `allowGuestInvites` (padrão `false`). |
| `portal.publish` | não | `true` (padrão) publica a personalização; `false` deixa só o rascunho. |

## O que a importação faz, na ordem

1. Cria o cliente (responsável: quem importa).
2. Grava o perfil da marca.
3. Envia cada arquivo para a biblioteca do cliente e define o logotipo.
4. Cria os projetos e, em cada um, as demandas (status inicial padrão).
5. Grava o rascunho do portal com as imagens certas, publica (se pedido) e
   ajusta endereço e login.

Permissões, validações, cotas e registro de atividade são os mesmos dos
formulários; o pacote só os orquestra. Código: `src/lib/validators/client-package.ts`,
`src/server/services/client-package.ts`, `src/app/api/clients/import/route.ts`.
