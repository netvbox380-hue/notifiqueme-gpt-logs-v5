# Diagnóstico Push Completo

A Central de Logs em `/logs` agora possui diagnóstico focado na cadeia de push:

- permissão do navegador;
- Service Worker registrado, ativo e controlador;
- subscription local e endpoint mascarado;
- histórico persistente do Service Worker (install, activate, push recebido, notificação exibida e clique);
- confirmação da mesma subscription no backend/Supabase;
- estado das chaves VAPID no servidor;
- quantidade de subscriptions do usuário no banco;
- botão de teste push real com resultado enviado/falha/expirada;
- logs do servidor para subscribe, teste e despacho de notificações.

Os endpoints completos e dados sensíveis não são incluídos nos relatórios exportados.
