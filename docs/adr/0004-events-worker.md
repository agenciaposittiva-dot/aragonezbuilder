# ADR 0004 — Eventos de domínio (outbox) e worker

**Status:** aceita · 18/10/2026

## Decisão
- Cada mutação relevante grava, **na mesma transação**, um registro de auditoria e um
  evento em `domain_events` (`recordActivity`). Se a operação falhar, nada é gravado;
  se for confirmada, o evento não se perde.
- Um gatilho faz `pg_notify('domain_events')`; o worker escuta e também faz varredura
  periódica. Ele gera notificações, envia e-mails (fila `email_outbox`), executa
  automações e processamento assíncrono (miniaturas), com novas tentativas.
- Em plataformas sem processo contínuo (ex.: Vercel), a rota protegida
  `/api/cron/tick` processa um lote por chamada.

## Consequências
Requisições HTTP nunca esperam por e-mail, miniatura ou integração externa.
