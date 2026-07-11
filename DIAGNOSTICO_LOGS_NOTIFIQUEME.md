# Central de Logs e Diagnóstico

A página existente `/logs` agora possui duas áreas:

- **Diagnóstico técnico**: monitora erros do dispositivo atual.
- **Auditoria do tenant**: mantém os registros administrativos já existentes.

## Eventos capturados

- erros JavaScript globais;
- promises rejeitadas sem tratamento;
- erros React capturados pelo ErrorBoundary;
- falhas de consultas e mutations tRPC;
- respostas HTTP com erro;
- requisições HTTP muito lentas;
- falhas de rede e mudanças online/offline;
- mensagens e troca de controller do Service Worker;
- diagnóstico de permissão push, subscriptions e registros de Service Worker;
- teste do endpoint `/healthz`.

## Privacidade

Os registros ficam no `localStorage` do próprio dispositivo, limitados aos 500 eventos mais recentes. Campos com nomes como token, senha, cookie, secret e private key são ocultados. URLs PostgreSQL também são removidas dos detalhes.

## Como usar

1. Abra **Logs** no menu administrativo.
2. Entre em **Diagnóstico técnico**.
3. Clique em **Executar diagnóstico**.
4. Reproduza o problema.
5. Volte à tela e clique em **Baixar relatório**.
6. Envie o JSON gerado sem editar.

O relatório não substitui os logs do Render. Erros que acontecem somente no servidor continuam visíveis em Render > Logs.
