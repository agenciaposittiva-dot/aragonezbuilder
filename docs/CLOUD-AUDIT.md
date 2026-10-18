# Auditoria da nuvem e do salvamento

Levantamento de onde cada informação do Aragonez fica guardada, quando é
salva e o que ainda pode se perder. Feito junto com a implementação da
"Minha Nuvem", do salvamento automático e do histórico de versões das artes.

## 1. Mapa do armazenamento

| O quê | Onde fica | Observações |
| --- | --- | --- |
| Dados (clientes, projetos, tarefas, solicitações, aprovações, configurações) | Postgres (Neon na produção) | Toda tabela de agência tem `organization_id` com RLS forçado: uma agência não lê a outra nem com um ID adulterado. |
| Documento das artes do Estúdio | `designs.document` (jsonb) | Só a estrutura da cena. Imagens novas entram como referência `/api/files/<versão>`, não como texto base64. |
| Histórico das artes | `design_versions` (jsonb + miniatura) | Pontos de controle automáticos, versões nomeadas, restaurações e as duas versões de um conflito. |
| Bytes dos arquivos | Driver de armazenamento (`STORAGE_DRIVER`) | `database` (tabela `storage_objects`), `blob` (Vercel Blob privado), `s3` ou `local` (disco). Escolha automática: S3 se houver bucket, Blob se houver token/loja, `database` na Vercel, `local` fora dela. |
| Metadados dos arquivos | `files`, `file_versions`, `folders` | Versões, checksum SHA-256, autor, cliente/projeto, status de aprovação, lixeira (`deleted_at`, `deleted_by_user_id`). |
| Miniaturas | Mesmo driver dos arquivos | Geradas no envio. |
| Rascunhos não confirmados | IndexedDB do navegador (`aragonez-drafts`; cai para `localStorage`) | Só como cópia temporária até o servidor confirmar (ver seção 3). |

### Produção hoje

Sem `BLOB_STORE_ID`/`BLOB_READ_WRITE_TOKEN` nem bucket S3, a produção na
Vercel usa o driver **`database`**: os arquivos ficam dentro do Postgres.
Funciona e entra no backup do banco, mas:

- cada MB enviado ocupa o plano do banco (o da Neon é bem menor e mais caro por GB que um armazenamento de objetos);
- dumps e restaurações ficam proporcionais ao volume de arquivos;
- o limite de corpo das funções da Vercel segura os envios em **4 MB** por arquivo (`UPLOAD_MAX_BYTES`).

**Recomendação:** conectar o **Vercel Blob (privado)** ao projeto
(*Storage → Create → Blob → Connect*). O driver passa a ser `blob` sozinho,
sem mudar código. Custo: cobrado por GB armazenado e transferido, na
ordem de centavos de dólar por GB/mês (confira a tabela atual do plano
em vercel.com/pricing). Arquivos que já estão no banco continuam lá e
seguem funcionando. A migração deles para o Blob fica para depois e
não é obrigatória. Para volumes grandes ou envios acima de 4 MB, um bucket
S3/R2 com envio direto é o próximo passo.

A cota da agência (Configurações → Armazenamento e versões) é um limite
**próprio**, conferido no servidor a cada envio. A plataforma nunca promete
espaço ilimitado: sem cota definida vale o limite do provedor, e a tela diz
isso.

## 2. Pontos de salvamento

| Tela | Como salva | Estado mostrado |
| --- | --- | --- |
| Editor de artes (Estúdio) | **Automático**: 1,2 s depois da última alteração, no máximo a cada 10 s de edição contínua. Também salva ao exportar, com Ctrl+S, ao trocar de aba e ao sair da página. | Indicador real: "Todas as alterações salvas", "Salvando alterações...", "Sem conexão — alterações pendentes", "Erro ao salvar — tentar novamente", "Conflito de edição — revisar alterações". "Salvo" só aparece depois da resposta do servidor. |
| Personalização do portal do cliente | **Automático** (rascunho). Publicar continua manual e, antes, envia o que estiver pendente. | Mesmo indicador. |
| Nova solicitação (agência e portal) | Cópia local enquanto se preenche; o envio continua manual. | Aviso de rascunho recuperado, com "Descartar rascunho". |
| Arquivos (Minha Nuvem) | Cada ação (enviar, renomear, mover, duplicar, arquivar, excluir) grava na hora, com confirmação. | Notificação de sucesso ou erro. |
| Demais formulários (clientes, projetos, configurações, tarefas) | Gravam ao enviar, numa transação. Erros mantêm o formulário preenchido. | Notificação. |

Garantias do salvamento automático (`src/lib/autosave/controller.ts`, `src/hooks/use-autosave.ts`):

- uma gravação por vez e em ordem: alterações feitas durante um envio entram no seguinte;
- sem rede, fica pendente e tenta de novo assim que a conexão volta;
- erro do servidor: novas tentativas com espera crescente (2 s, 4 s, 8 s… até 1 min) e botão "tentar novamente";
- aviso do navegador ao fechar a aba com algo pendente;
- controle de revisão no servidor: se outra sessão salvou antes, nada é sobrescrito em silêncio. A pessoa escolhe a versão que vale e **a outra fica no histórico** de versões.

## 3. Estado que existe só no navegador

- **Tema claro/escuro** (`localStorage`): preferência visual, sem risco.
- **Rascunhos temporários** (IndexedDB): as alterações do editor, da personalização do portal e de uma nova solicitação ficam no aparelho até o servidor confirmar. Ao reabrir, a tela oferece "Recuperar alterações". Sem confirmação do servidor nunca aparece "salvo". A cópia é apagada quando a confirmação chega.

Nada de trabalho fica guardado só no navegador.

## 4. Segurança dos arquivos

- O link estável `/api/files/<versão>` confere sessão, agência, permissão e escopo (cliente do portal só vê o que foi compartilhado com ele). Depois redireciona para um link assinado que vale **5 minutos**.
- IDs adulterados ou de outra agência respondem 404, sem revelar se o arquivo existe (teste e2e "ID adulterado…").
- Tipo e tamanho são validados no servidor a cada envio: lista de tipos da agência, limite por arquivo e cota.
- Excluir pede confirmação, avisa quando a imagem é usada em alguma arte e manda para a Lixeira por 30 dias. Restaurar devolve o arquivo. Excluir definitivamente apaga os objetos do armazenamento só depois do commit.
- Ações sobre arquivos e versões entram no log de auditoria.

## 5. Limitações conhecidas

- Artes antigas podem ter imagens embutidas em base64 (data URL) no documento. Elas continuam funcionando, mas não aparecem na Minha Nuvem nem são contadas como "arquivo em uso".
- Ainda não há modelos de carrossel nem de JPG no Estúdio. As exportações PNG/JPG vão para a central como arquivo comum.
- Restaurar um arquivo da Lixeira não reabre aprovações que foram canceladas na exclusão.
- Arquivos excluídos antes desta versão (sem `deleted_by_user_id`) não são apagados sozinhos depois de 30 dias. Ficam na Lixeira até alguém excluí-los definitivamente.
- A limpeza automática da Lixeira (30 dias) depende do cron diário (`/api/cron/tick`), que só roda com `CRON_SECRET` definido. A retenção de versões das artes não depende dele: é aplicada a cada nova versão.
- O rascunho do portal não tem controle de revisão: duas pessoas editando o mesmo portal ao mesmo tempo ficam com a última gravação (o publicado só muda ao publicar).
- A cópia local é por navegador: alterações nunca confirmadas num aparelho não aparecem em outro.
