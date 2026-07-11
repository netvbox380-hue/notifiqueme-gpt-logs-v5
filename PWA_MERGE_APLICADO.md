# PWA merge aplicado

Base usada: `final-3`

Aproveitado do ajuste novo, sem levar a lógica mais invasiva:

- `client/src/lib/push.ts`
  - remove erro escondido por `catch {}`
  - mostra mensagem real quando o contexto não é HTTPS/localhost
  - usa `registerServiceWorker()` quando não há registro

- `client/src/lib/pwa-register.ts`
  - mantém simplicidade da base estável
  - remove somente Service Workers antigos que não sejam `/sw.js`
  - reaproveita registro existente válido antes de registrar de novo

- `client/src/App.tsx`
  - mantém listeners e toasts da base estável
  - evita limpeza agressiva por faixa de IP, restringindo a limpeza automática ao DEV real/localhost

Mantido intacto da base estável:

- `client/public/sw.js`
- `client/public/manifest.json`
- `client/public/manifest.webmanifest`
- `client/src/main.tsx`
- dependências do projeto
- lógica de instalação, cache, badge, vibração e navegação do SW
