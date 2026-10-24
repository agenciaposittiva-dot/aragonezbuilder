# Portal exclusivo do cliente — situação

Cada cliente tem um portal em `/portal/<agência>/<cliente>`, com login próprio
(`/entrar`), identidade visual publicada pela agência e acesso restrito aos
convidados daquele cliente. O isolamento é aplicado no servidor (ator
restrito ao cliente do endereço) e no banco (RLS por organização).

## O que existe

- **Endereço e acesso:** endereço único por cliente (com conflitos e nomes
  reservados tratados), login próprio liga/desliga, convites de colegas pelo
  administrador do cliente (opcional).
- **Personalização** (Clientes › cliente › Portal): rascunho, prévia
  (login/início, computador/celular), publicação com versões, restaurar versão
  ou o padrão da agência; logotipos, favicon, 5 cores com contraste mínimo de
  4,5:1, boas-vindas, login com imagem de fundo, banner com imagem, foco,
  altura, sobreposição e botão, banners extras (com 2 ou mais, o início vira
  um carrossel com setas, pontos, toque para deslizar e rolagem automática
  com intervalo configurável, que pausa com o mouse e respeita a preferência
  de menos movimento), links, botões de ação, contato e seções do painel. Links só `https`, `mailto`, `tel` ou caminhos do portal; imagens só
  do próprio cliente.
- **Login personalizado:** usa a autenticação existente; mensagens de erro
  genéricas; sem cadastro aberto (acesso por convite).
- **Convidados** (Clientes › cliente › Convidados): papéis Cliente (acesso
  completo), Administrador do cliente, Solicitante (só as próprias
  solicitações), Aprovador e Visualizador; convite com validade de 1 a 30
  dias, link de uso único, reenvio, revogação, troca de papel e remoção de
  acesso. Sem SMTP, a tela diz que o e-mail não foi enviado e mostra o link.
- **Painel do cliente:** banner, ações, indicadores, aprovações pendentes,
  entregas, arquivos finais, solicitações, prazos, projetos visíveis,
  notificações, links e contato, conforme as seções ligadas.
- **Solicitações, aprovações e arquivos** sobre os mesmos registros da
  agência: pedir ajustes exige motivo; arquivos do cliente entram como
  referência; o convidado só vê o que foi compartilhado; dados de tarefas
  internas, custos e comentários internos nunca chegam ao portal.
- **Notificações** com preferências por assunto e canal (plataforma/e-mail).
- **Logo da agência** no portal só quando a agência ativa a opção.
- **Lixeira:** cliente excluído tira o portal do ar (login, imagens e acesso)
  até ser restaurado.

## Testes de aceitação (pedido, item 14)

| # | Critério | Onde é verificado |
|---|---|---|
| 1 | Dois clientes com identidades diferentes | e2e `portal-acceptance` (1–4) |
| 2 | Banners e logotipos diferentes | e2e `portal-acceptance` (1–4) |
| 3 | Prévia e publicação | e2e `portal-acceptance` (1–4); vitest `client-portal` |
| 4 | Cada portal com a própria identidade | e2e `portal-acceptance` (1–4), `portal` |
| 5 | Convidar usuário externo | e2e `portal-acceptance` (5–7); vitest `guests` |
| 6 | Aceitar convite e autenticar | e2e `portal-acceptance` (5–7) |
| 7 | Convidado acessa só o cliente certo | e2e `portal-acceptance` (5–7), `portal` |
| 8 | Revogar e negar depois | e2e `portal-acceptance` (8); vitest `guests` |
| 9 | Demanda no portal aparece na agência | e2e `portal-acceptance` (9) |
| 10 | Enviar arte para aprovação | e2e `portal-acceptance` (10–14) |
| 11 | Aprovar como convidado | e2e `portal-acceptance` (10–14); vitest `approvals` |
| 12 | Pedir ajustes em outra versão (com motivo) | e2e `portal-acceptance` (10–14); vitest `guests` |
| 13 | Histórico registrado | e2e `portal-acceptance` (10–14) |
| 14 | Arquivos privados protegidos | e2e `portal-acceptance` (10–14); vitest `portal`, `files` |
| 15 | Responsivo (computador e celular) | e2e `portal` nos dois tamanhos (sem rolagem lateral) |
| 16 | Erros de autenticação e convite expirado | e2e `portal-acceptance` (16), `portal`; vitest `guests`, `invitations` (expirado/revogado/usado) |
| 17 | Acesso cruzado entre clientes | e2e `portal-acceptance` (5–7), `portal`; vitest `client-portal`, `tenant-isolation` |
| 18 | Funciona sem personalização | e2e `portal-acceptance` (1–4: terceiro cliente sem portal publicado) |

Rodar: banco migrado com `npm run db:seed`, aplicação no ar e
`E2E_BASE_URL=http://localhost:3000 npx playwright test`.

## Pendências conhecidas

- O estado do e-mail de cada convite é inferido do envio (destinatário,
  assunto e horário); uma coluna `email_outbox.invitation_id` tornaria isso
  exato.
- O aviso de decisão vai para a equipe interna; outros aprovadores do mesmo
  cliente não são avisados da decisão de um colega.
- Páginas "não encontrado" dentro de rotas com carregamento progressivo
  respondem HTTP 200 (o conteúdo é a página de não encontrado).
