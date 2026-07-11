# Deploy 100% no Netlify (Frontend + API via Functions)

Este projeto foi ajustado para rodar **tudo no Netlify**:
- **Frontend**: build Vite em `dist/public`
- **Backend**: Express + tRPC rodando como **Netlify Function** em `/.netlify/functions/api`
- **Banco**: **PostgreSQL externo** (Netlify não hospeda Postgres)

## 1) Banco PostgreSQL
Crie um Postgres em um provedor (ex.: Render Postgres, Neon, Supabase, Railway, etc) e copie a `DATABASE_URL`.

Depois rode as migrações/tabelas:
- local: `npm install` e `npm run db:init`
- ou em qualquer ambiente que tenha acesso ao Postgres

> Importante: o Netlify **não** executa `db:init` automaticamente no deploy.

## 2) Configuração no Netlify
O arquivo `netlify.toml` já está pronto.

No Netlify, em **Site settings → Build & deploy**:
- Build command: `npm run build:client`
- Publish directory: `dist/public`
- Functions directory: `netlify/functions`

## 3) Variáveis de ambiente (Netlify → Environment variables)
Obrigatórias:
- `DATABASE_URL`
- `JWT_SECRET` (ou `COOKIE_SECRET`)
- `COOKIE_SECRET` (ou `JWT_SECRET`) — ideal ter as duas iguais
- `APP_URL` (URL do seu site no Netlify, ex: https://seu-site.netlify.app)

Recomendadas (produção):
- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT`
- `CRON_SECRET` (se você usa endpoints protegidos por cron)

Owner inicial:
- `OWNER_OPEN_ID`
- `OWNER_PASSWORD` (se você inicializa owner por senha)

## 4) Rotas / API
- Front chama a API no mesmo domínio (`window.location.origin`).
- As rotas `/api/*` são redirecionadas para a function `api`.

## 5) Teste rápido
Após deploy:
- Abra `https://SEU_SITE.netlify.app/healthz` → deve responder `ok`
- Teste login e chamadas tRPC.

Se login não “persistir”, confira:
- `APP_URL` correto
- `JWT_SECRET/COOKIE_SECRET` definidos
- `NODE_ENV=production` (Netlify costuma setar automaticamente)
