# Correção do card de ativação após reload

## Problema
O banner de ativação podia montar antes de o registro do Service Worker terminar. Nesse intervalo, `usePushStatus()` concluía que não havia subscription e mantinha o card visível, enquanto o menu detectava a subscription por outro estado local.

## Correções
- `usePushStatus()` agora aguarda/garante o Service Worker quando a permissão já está concedida.
- O registro existente solicita `update()` de forma segura.
- O status é reavaliado em `pageshow`, `focus`, `visibilitychange` e `controllerchange`.
- `InstallAppButton` passou a usar `usePushStatus()` em vez de manter um segundo estado independente.
- Durante a verificação aparece estado neutro, e não o botão incorreto de ativação.
- Após sincronizar a subscription com o backend, o status global é atualizado imediatamente.

## Validação
- 31 testes aprovados.
- Build do cliente aprovado.
- Build do servidor aprovado.
