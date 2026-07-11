# Ajustes aplicados

## Entrega sem depender de push
- A mensagem agora é entregue primeiro na caixa de entrada (`deliveries`) como `delivered`.
- Push virou canal complementar.
- Se o usuário não ativou notificações, o agendamento continua como entregue e o detalhe informa que ficou apenas na caixa de entrada.
- Se uma assinatura push estiver inválida/expirada, ela é removida automaticamente do banco.

## Status administrativo
- Agendamento não fica mais como falha total só porque o usuário não ativou push.
- `lastSuccessCount` agora reflete a entrega real na caixa de entrada.
- `lastFailureCount` fica reservado para falhas reais de execução.
- O admin recebe detalhe como:
  - push enviado
  - usuário sem push ativo, entregue na caixa de entrada
  - push com falha, mensagem preservada na caixa de entrada

## Recorrência ampliada
- Mantido `Uma vez`
- Adicionado:
  - `Hora` (`hourly`)
  - `Diária` (`daily`)
  - `Semanal` (`weekly`)
  - `Mensal` (`monthly`)
  - `Anual` (`yearly`)

## Compatibilidade de banco
- `ensureSchema` agora adiciona `hourly` e `yearly` ao enum `recurrence` em bancos antigos.
- Não remove colunas, não altera S3, não altera variáveis de ambiente e não muda o cron do Netlify.

## Arquivos ajustados
- `server/_core/push.ts`
- `server/_core/queue.ts`
- `server/_core/adminAlerts.ts`
- `server/_core/systemRouter.ts`
- `server/routers/schedules.ts`
- `server/_core/ensureSchema.ts`
- `drizzle/schema.ts`
- `scripts/create-tables.sql`
- `client/src/pages/Schedule.tsx`
- `client/src/types/index.ts`

## Observação
- A checagem `npm run check` neste ambiente continuou bloqueada por ausência dos typings `node` e `vite/client` já no pacote recebido.
