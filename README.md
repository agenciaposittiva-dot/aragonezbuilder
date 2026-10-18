# Aragonez · Plataforma de gestão para agências

Plataforma SaaS multi-agência para gestão de clientes, projetos, tarefas, solicitações,
aprovações por versão, arquivos, IA, editor de artes, relatórios, automações, financeiro e
área exclusiva para clientes.

> Em desenvolvimento. A documentação completa (arquitetura, decisões, como rodar e como
> publicar) fica em `docs/`.

## Rodando localmente

```bash
cp .env.example .env          # ajuste as variáveis
npm install
npm run db:migrate            # aplica migrações + RLS
npm run dev                   # aplicação em http://localhost:3000
npm run dev:worker            # em outro terminal: e-mails, notificações, automações
```
