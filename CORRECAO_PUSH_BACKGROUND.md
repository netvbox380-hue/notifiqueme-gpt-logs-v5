# Correção do push após reload/fechamento

Alterações aplicadas:

- A subscription local agora é sincronizada novamente com o backend em cada nova sessão/reload autenticado, mesmo quando já existe no navegador.
- O envio de push em `notifications.send` agora é aguardado e o resultado é registrado nos logs do Render.
- A resposta da rota inclui resumo do despacho (`configured`, `sent`, `failed`, `skipped`).
- O polling da inbox passou a ser apenas fallback visível, a cada 15 segundos, evitando mascarar falhas do Web Push real.
- Alertas locais de polling não são disparados com a página oculta.
- Cache do Service Worker incrementado para v9, forçando atualização do worker após deploy.

Validação:

- 31 testes aprovados.
- Build do cliente aprovado.
- Build do servidor aprovado.

Observação: o comando `npm run check` ainda aponta erros TypeScript antigos em módulos não relacionados ao push neste ZIP de origem.
