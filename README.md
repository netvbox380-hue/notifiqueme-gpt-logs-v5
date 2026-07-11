# Notifique-Me - Sistema de Notificações Multi-Tenant

Sistema SaaS para gerenciamento e envio de notificações (multi-tenant), com **backend em Node/Express + tRPC** e **banco PostgreSQL**.

> ✅ Este projeto está **100% sem Firebase** (zero dependências, zero variáveis, zero integrações).

## 🏗️ Arquitetura

| Categoria | Tecnologia | Descrição |
| :--- | :--- | :--- |
| **Frontend** | React 19 + TypeScript | Interface reativa e tipada |
| **Backend** | Node.js + Express + tRPC | API com tipos seguros |
| **Banco de Dados** | PostgreSQL | Persistência relacional |
| **Autenticação/Sessão** | Login local + Cookie HTTPOnly | Sessão via token no cookie (`auth.login`) |
| **Build Tool** | Vite | Ambiente de desenvolvimento |
| **Styling** | Tailwind CSS 4 + shadcn/ui | UI moderna |
| **Multi-tenant** | Um banco, múltiplos tenants | Isolamento de dados por cliente |

---

## 👥 Sistema de Roles

O sistema possui 3 níveis de acesso:

| Role | Descrição | Permissões |
|------|-----------|------------|
| **owner** | Super Admin do sistema | Gerencia todos os tenants, cria admins, acesso total |
| **admin** | Administrador de um tenant | Gerencia usuários e notificações do seu tenant |
| **user** | Usuário comum | Recebe notificações, acesso limitado |

### Definindo o Owner

O Owner é definido pela variável `OWNER_OPEN_ID` no `.env`. O email configurado será automaticamente promovido a **owner** no primeiro login.

---

## 🚀 Guia de Instalação

### Pré-requisitos

- **Node.js**: versão 18 ou superior
- **Git**: para clonar o repositório
- **PostgreSQL**: local (Docker) ou gerenciado (Render/Railway/etc.)

### Passo 1: Clonar e Instalar

```bash
git clone <URL_DO_REPOSITORIO>
cd notifique-me
npm install
```

### Passo 2: Configurar Variáveis de Ambiente

Crie/edite o arquivo `.env` (exemplo mínimo):

```env
# Database Connection (PostgreSQL)
DATABASE_URL=postgresql://user:password@localhost:5432/notifique_me

# Server Configuration
PORT=3000
HOST=0.0.0.0
NODE_ENV=development

# SuperAdmin/Owner Configuration
OWNER_OPEN_ID=seu_email@exemplo.com

# JWT Secret (CRÍTICO: gere uma string aleatória segura)
JWT_SECRET=sua_chave_secreta_aqui
```

### Passo 3: Inicializar o Banco de Dados

```bash
npm run db:init
```

### Passo 4: Executar em Desenvolvimento

```bash
npm run dev
```

✅ Este comando usa **Netlify Dev** para manter o comportamento igual ao deploy
(Frontend + API via Functions).

Acesse: **http://localhost:8888**

---

## 🏢 Multi-Tenant

Cada tenant (cliente) possui:
- Usuários isolados
- Grupos próprios
- Notificações separadas
- Assinatura com data de expiração

### Fluxo de Criação

1. **Owner faz login** → Acessa "Área do Dono"
2. **Cria Tenant** → Nome, slug, plano, duração
3. **Cria Admin** → Email, nome, seleciona tenant
4. **Admin faz login** → pelo próprio email (login local)
5. **Admin gerencia** → Usuários e notificações do seu tenant

---

## 📱 Funcionalidades

- ✅ Login/Logout local (sem dependências externas)
- ✅ Dashboard com estatísticas por role
- ✅ CRUD de tenants (owner)
- ✅ CRUD de usuários/admins (owner/admin)
- ✅ Sistema de notificações e agendamentos (worker)
- ✅ Multi-tenant com isolamento por `tenantId`

---

## 🐳 Docker (PostgreSQL + App)

Suba tudo localmente:

```bash
docker compose up --build
```

- App: **http://localhost:3000**
- Postgres: **localhost:5432**

---

## 🧪 Testes

```bash
npm test
```

---

## 📦 Scripts úteis

- `npm run db:init` → cria tabelas e inicializa owner
- `npm run db:push` → gera/migra via Drizzle
- `npm run worker` → processa agendamentos



## Agendamentos com recorrência (Schedules)

- Produção (Netlify): há uma Scheduled Function em `netlify/functions/cron-run-schedules.ts` que executa `system.runSchedules` a cada 1 minuto. Configure `CRON_SECRET` nas variáveis de ambiente do site.
- Dev (local): o Netlify Dev não executa schedules automaticamente. Para testar manualmente:

```bash
npm run run:schedules
```

Para rodar em loop:

```bash
npm run run:schedules -- --loop --interval=60
```
