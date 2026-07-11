# GARANTIA INBOX OWNER / ADMIN / USUÁRIO

## Aplicado neste pacote

### Entrega e público
- owner/admin enviando mensagem -> usuário final vê na inbox ao abrir o app
- push continua opcional
- agendamento continua salvando na inbox
- owner não resolve mais `all/users` para admins por engano
- grupos do owner agora resolvem membros usuários do grupo
- fila/worker mantém criação de deliveries idempotente

### Service worker
- registro padronizado em `/sw.js`

### Tela do usuário final
- destaque visual de mensagens não lidas
- clique na mensagem marca como lida automaticamente
- contador de não lidas sincronizado com inbox
- invalidação em tempo real por polling + push ping + focus/visibility
- respostas rápidas persistidas com feedback visual
- botão `Marcar todas como lidas`
- paginação simples por `Carregar mais mensagens`
- logo/branding do admin integrado na inbox
- botão WhatsApp integrado com link clicável

### Modal de agendamento
- corpo do modal com espaço inferior extra
- campos de data/prioridade empilham no celular
- listas de usuários/grupos com scroll próprio
- botão não deve mais cobrir a lista em mobile/desktop

## Arquivos principais alterados
- `server/routers/notifications.ts`
- `server/_core/systemRouter.ts`
- `server/_core/queue.ts`
- `client/src/pages/UserNotifications.tsx`
- `client/src/pages/Schedule.tsx`
- `client/src/lib/pwa-register.ts`
- `client/src/lib/pwa.test.ts`

## Observação honesta
A checagem completa do TypeScript continua dependente do ambiente do ZIP original. As mudanças acima foram aplicadas no código-fonte e reempacotadas neste pacote.
