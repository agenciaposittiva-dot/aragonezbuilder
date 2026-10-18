# ADR 0002 — Cache Components desligado

**Status:** aceita · 18/10/2026

## Contexto
O Next.js 16 oferece `cacheComponents` (prerender parcial). Com ele ligado, toda leitura
de sessão/cookies precisa ficar dentro de `<Suspense>` e rotas ficam montadas em
`<Activity>` ao navegar.

## Decisão
Desligado nesta fase. Todas as telas da plataforma são autenticadas e cada consulta
roda numa transação restrita à organização (RLS); não há conteúdo estático
compartilhável que justifique o custo de adaptação.

## Consequências
- Páginas são renderizadas sob demanda (dinâmicas). Após uma mutação, a action chama
  `refresh()` e a página volta atualizada na mesma resposta.
- O Next anuncia o recurso como padrão na próxima versão maior: a migração deve seguir
  o guia `migrating-to-cache-components` (envolver leituras de sessão em Suspense).
