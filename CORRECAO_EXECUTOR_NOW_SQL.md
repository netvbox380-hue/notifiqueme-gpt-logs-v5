# Correção complementar do executor

- Mantive Date nos campos timestamp do Drizzle.
- Removi o uso de Date JS na comparação SQL crua de schedules vencidos.
- O filtro de vencimento agora usa NOW() do Postgres, evitando o erro original do postgres-js.
