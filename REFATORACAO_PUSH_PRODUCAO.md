# Refatoração da cadeia de Push — versão Render

## Escopo
- Cliente: `client/src/lib/push.ts`
- Preferências e badge: `client/src/lib/user-notifications.ts`
- Caixa de entrada: `client/src/pages/UserNotifications.tsx`
- Service Worker: `client/public/sw.js`
- Motor do servidor: `server/_core/push.ts`
- Subscription/teste: `server/routers/push.ts`
- Disparo direto: `server/routers/notifications.ts`

## Garantias preservadas
- `react-day-picker` permanece em `8.10.1`.
- `render.yaml`, scripts de Render e conexão por `DATABASE_URL` não foram alterados.
- Nenhuma migration ou alteração de schema foi criada.
- Endpoints tRPC públicos existentes foram preservados.

## Melhorias
- Um único motor de envio push para fila, alertas e envio direto.
- Resultado por usuário: enviado, falhou ou entregue apenas na caixa de entrada.
- Remoção somente de subscriptions realmente expiradas (404/410 e equivalentes).
- Suporte a múltiplos dispositivos por usuário.
- Badge e `deliveryId` individualizados por destinatário.
- Preferências de som e vibração isoladas em utilitário reutilizável.
- Detecção de suporte, HTTPS, PWA no iOS e estado da subscription mais segura.
- Menos `any`, menos `@ts-ignore` e responsabilidades menores em `UserNotifications`.
- Service Worker atualizado para cache v8 e payload consistente.
- Teste de logout corrigido com mock realista de resposta HTTP.

## Validação
- `npm run build`: aprovado.
- `npm test`: 31/31 testes aprovados.
