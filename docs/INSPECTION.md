# Inspeção inicial (antes de qualquer alteração)

Data: 18/10/2026.

## Repositório `agenciaposittiva-dot/aragonezbuilder`

- Estado: **vazio** (nenhum commit, nenhum arquivo). Não havia stack, dependências,
  rotas, banco, migrações, autenticação, testes ou alterações locais a preservar.
- Consequência: foi criada uma arquitetura inicial documentada (este diretório `docs/`).
- Primeiro branch publicado: `claude/quirky-fermi-xkdpc2`. Como o repositório não tinha
  `main`, esse branch passou a ser o padrão no GitHub.

## Repositório `agenciaposittiva-dot/bjjshouse` (inspecionado primeiro)

- Página de vendas estática (HTML/CSS/JS, sem build, sem dependências, sem testes) de
  um cliente da agência, publicada pelo GitHub Pages. Repositório **público**.
- Não tem relação com a plataforma; não foi alterado.

## Ambiente de desenvolvimento

- Node 22, npm 10, PostgreSQL 16 local, Chromium para testes de navegador.
- Sem Docker disponível: o armazenamento S3 foi implementado e documentado, e o
  desenvolvimento usa o driver de armazenamento local.

## Problemas encontrados durante a evolução

| Data | Problema | Tratamento |
|---|---|---|
| 18/10 | Build na Vercel falhava sem variáveis de ambiente (validação no import). | `env.ts` usa valores provisórios só durante `next build`; em execução a validação continua obrigatória. |
| 18/10 | Vercel respondia 404 em todas as rotas (preset "Other" porque o projeto foi criado com o repositório vazio). | `vercel.json` fixa `"framework": "nextjs"`. |
| 18/10 | Consultas em paralelo (`Promise.all`) dentro da mesma transação — o driver `pg` descontinua esse uso. | Helper `inSequence` para consultas na mesma transação. |
| 18/10 | Conversão dupla de valores (ex.: R$ → centavos aplicado duas vezes) por validar na action e no serviço. | `orgAction` valida e repassa a entrada original; o serviço é o único dono da conversão. |
