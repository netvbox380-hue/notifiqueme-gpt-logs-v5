# Correção do card de push após recarregar

- Estado de push centralizado em uma única fonte global (`useSyncExternalStore`).
- Banner e menu deixam de executar verificações independentes.
- Respostas assíncronas antigas não podem sobrescrever uma leitura mais nova.
- Subscription é procurada em todos os registros de Service Worker.
- A simples leitura de status não chama mais `registration.update()`, evitando a janela em que um novo registro ainda não possui subscription.
- A subscription existente é reutilizada antes de criar uma nova.

Validação: 31 testes aprovados e builds de cliente/servidor concluídos.
