# Render - adaptação total aplicada

## O que foi adaptado

### 1) Web service principal
- build completo do frontend + backend no próprio Render
- start unificado via `node dist/index.js`
- `healthCheckPath` corrigido para `/healthz`
- frontend estático continua sendo servido pelo Express
- fallback SPA mantido

### 2) Schedules / recorrência
- blueprint agora cria um **cron job próprio** para rodar `system.runSchedules` a cada minuto
- o cron usa `CRON_SECRET`
- isso deixa os agendamentos independentes do tráfego do site

### 3) Queue / envio em segundo plano
- blueprint agora cria um **background worker dedicado**
- worker roda `run-queue.ts --loop --interval=5`
- a fila continua processando os disparos desacoplada do web service

### 4) Limpeza automática
- adicionado `scripts/run-cleanup.ts`
- blueprint agora cria um **cron job semanal** para `system.cleanupOldMessages`

### 5) Variáveis de ambiente
- `render.yaml` foi reorganizado com `envVarGroups`
- segredos comuns ficam centralizados
- `DATABASE_URL` vem automaticamente do banco Render Postgres

### 6) Uploads no Render
- agora o projeto aceita `UPLOADS_DIR`
- no blueprint, o web service monta um **persistent disk** em `/var/data/notifique-me`
- uploads locais passam a usar `/var/data/notifique-me/uploads`
- a rota `/uploads/*` é servida direto pelo Express quando o storage estiver em modo local

## Arquitetura final no Render
- **web**: frontend + api + auth + mídia
- **worker**: processa job_queue continuamente
- **cron 1**: executa schedules/recorrência a cada minuto
- **cron 2**: limpeza automática semanal
- **postgres**: banco principal
- **disk**: uploads locais persistentes

## Variáveis que você ainda precisa preencher no Render
- `APP_URL`
- `OWNER_OPEN_ID`
- `OWNER_PASSWORD`
- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT`
- `OAUTH_SERVER_URL`
- `VITE_OAUTH_PORTAL_URL`
- `BUILT_IN_FORGE_API_URL`
- `BUILT_IN_FORGE_API_KEY`

## Uploads: recomendação
Se você já usa S3 em produção, continue usando S3.
O disk foi deixado como fallback persistente para Render quando quiser rodar sem S3.
