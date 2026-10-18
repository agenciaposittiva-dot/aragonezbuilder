# Backup e restauração

Um backup só vale se a restauração já foi testada. Este documento descreve
o que precisa de backup, como restaurar e a rotina que prova,
periodicamente, que a restauração funciona.

## O que precisa de backup

| Parte | Onde | Backup |
| --- | --- | --- |
| Banco (todos os dados, documentos das artes, histórico de versões) | Postgres/Neon | Recuperação por ponto no tempo (PITR) da Neon + dump lógico testado (abaixo). |
| Bytes dos arquivos com `STORAGE_DRIVER=database` | Tabela `storage_objects`, no mesmo banco | Vêm junto com o banco. |
| Bytes dos arquivos com Blob/S3 | Vercel Blob / bucket | Fora do dump. O teste confere que cada arquivo citado no banco existe no armazenamento. Para o S3, ative o versionamento do bucket. O Vercel Blob não tem lixeira: arquivos só são apagados pela exclusão definitiva da Lixeira do Aragonez (30 dias depois). |
| Variáveis de ambiente | Vercel | Guarde `BETTER_AUTH_SECRET` e `ENCRYPTION_KEY` num cofre de senhas. As chaves de IA guardadas no banco são cifradas com a `ENCRYPTION_KEY` (ou, sem ela, com uma chave derivada do `BETTER_AUTH_SECRET`). Sem a chave certa, elas não abrem. |

## Proteção contínua (produção)

1. **Neon → Settings → Storage/History retention**: deixe o histórico em pelo menos 7 dias (o plano gratuito tem menos). Isso permite voltar o banco a qualquer instante dentro da janela.
2. **Antes de migrações que alteram ou apagam dados**: crie um *branch* na Neon (é instantâneo) ou rode o dump abaixo.
3. Erros do dia a dia não precisam de backup: arquivos e cadastros excluídos ficam 30 dias na Lixeira, e as artes têm histórico de versões com restauração.

## Dump manual

O banco usa RLS forçado, então o dump precisa do usuário dono das tabelas e
do desvio de RLS da própria aplicação:

```bash
PGOPTIONS="-c app.rls_bypass=on" pg_dump --format=custom --enable-row-security \
  --no-owner --no-acl --file=aragonez-$(date +%F).dump "$DATABASE_OWNER_URL"
```

Use um `pg_dump` da mesma versão maior do servidor, ou mais nova. Na Neon,
use a conexão direta, sem `-pooler`.

## Restauração

Sempre num banco **novo**. Confira e só depois aponte a aplicação para ele.

```bash
createdb aragonez_restaurado            # ou um branch/banco novo na Neon
PGOPTIONS="-c app.rls_bypass=on" pg_restore --no-owner --no-acl --exit-on-error \
  --dbname="postgres://.../aragonez_restaurado" aragonez-AAAA-MM-DD.dump
DATABASE_URL=... DATABASE_OWNER_URL=... npm run db:migrate   # recria papéis/permissões e confere o RLS
```

Depois troque `DATABASE_URL`/`DATABASE_OWNER_URL` na Vercel e faça um novo
deploy. Pela Neon, o caminho mais rápido é *Restore* para um instante
anterior, ou criar um branch nesse instante e promovê-lo.

## Teste de restauração (`scripts/backup-check.ts`)

O script faz o ciclo completo e falha (código 1) se algo não bater:

1. abre uma transação `REPEATABLE READ` na origem e exporta o snapshot;
2. `pg_dump` exatamente desse snapshot (dados que chegam durante o teste não geram falso alarme);
3. recria um banco de rascunho `<banco>_restore_check` e restaura o dump nele;
4. compara a contagem de linhas de **todas** as tabelas (origem no mesmo snapshot × restaurado);
5. confere os arquivos: cada versão registrada precisa existir no armazenamento, e uma amostra é baixada e comparada em tamanho e SHA-256;
6. apaga o banco de rascunho (ou o mantém com `--keep`).

```bash
npx tsx --tsconfig tsconfig.node.json scripts/backup-check.ts --env .env
#   --target-server <url>  cria o rascunho em outro servidor
#   --target-db <nome>     nome do rascunho (precisa terminar em _restore_check)
#   --sample <n>           quantos arquivos comparar byte a byte (padrão 20)
#   --out <arquivo.dump>   guarda o dump gerado
```

O script só lê a origem. Ele se recusa a usar como rascunho um banco com o
mesmo nome da origem ou um nome sem o sufixo `_restore_check`.

### Execução registrada (ambiente de desenvolvimento)

```
Origem: aragonez_g (snapshot 00000009-0000075A-1)
Dump: …/aragonez_g.dump (423 KB, 53 tabelas)
Restaurado em: aragonez_g_restore_check
Linhas conferidas: 1824 em 53 tabelas
Arquivos (local): 23 versões encontradas, 20 comparadas byte a byte

OK: backup restaurado e conferido em 3.6s.
```

Prova de que a conferência pega problemas: com o armazenamento apontando
para uma pasta vazia, o script terminou com código 1 e listou cada
`arquivo ausente`.

## Rotina periódica

`.github/workflows/backup-check.yml` roda toda segunda às 03:17 (Brasília)
e também sob demanda (*Actions → Teste de restauração do backup → Run
workflow*). O dump de produção é restaurado num Postgres 17 descartável do
próprio runner: nada é criado na Neon. Para ativar:

1. GitHub → *Settings → Secrets and variables → Actions*:
   - segredo `BACKUP_CHECK_DATABASE_URL`: conexão **direta** da Neon (sem `-pooler`) com o usuário dono das tabelas;
   - com Blob: segredo `BLOB_READ_WRITE_TOKEN` e variável `STORAGE_DRIVER=blob`;
   - com S3: variáveis `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, segredos `S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY` e `STORAGE_DRIVER=s3`.
2. Ative as notificações de falha de workflows no GitHub. Uma execução vermelha quer dizer que o backup **não** volta inteiro: investigue no mesmo dia.

Sem o segredo, o job só avisa que está desativado.

Além da rotina automática, uma vez por trimestre restaure manualmente
pela Neon (branch num instante anterior) e abra a aplicação apontando para
ele. Isso também confere as variáveis de ambiente e o deploy.
