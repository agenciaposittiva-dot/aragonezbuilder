# ADR 0003 — Isolamento multi-tenant em três camadas

**Status:** aceita · 18/10/2026

## Decisão
1. **Aplicação** — todo serviço recebe um `Scope` (`{ db, actor }`). O ator é resolvido no
   servidor a cada requisição (sessão → vínculo ativo → papel → permissões). Cada
   serviço verifica permissões (`assertCan`) e escopo de dados (`projectScope`,
   `clientScope`, `taskScope`, `fileScope`): colaboradores sem `data.all` veem só o que
   lhes foi atribuído; usuários de cliente veem apenas seus clientes e o que foi
   compartilhado explicitamente.
2. **Integridade** — tabelas filhas referenciam os pais por **chave estrangeira composta**
   `(organization_id, id)`. É impossível, no banco, um projeto da agência B apontar para
   um cliente da agência A.
3. **Banco (RLS)** — toda tabela com `organization_id` tem RLS **forçado**. Cada operação
   roda em transação com `set_config('app.org_id', ...)`. Mesmo uma consulta que esqueça
   o filtro só enxerga a organização corrente. O papel de execução não é superusuário
   nem tem `BYPASSRLS` (o script de migração avisa se tiver).

Operações que por natureza cruzam organizações (resolver o ator no login, listar as
organizações do usuário, criar organização, despachar eventos no worker) usam
`withSystem`, que liga `app.rls_bypass` de forma pontual e auditável no código.

## Testes
`tests/tenant-isolation.test.ts` cobre listagem, acesso direto por id, edição, criação
cruzada, leitura sem filtro (RLS) e inserção em outra organização (RLS).
