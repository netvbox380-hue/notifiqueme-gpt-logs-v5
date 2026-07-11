#!/usr/bin/env node
/**
 * Script de Inicialização do Banco de Dados
 * 
 * Este script cria automaticamente o usuário Admin Dono no banco de dados.
 * Deve ser executado após as migrações do banco de dados.
 * 
 * Uso:
 *   node scripts/init-superadmin.mjs
 * 
 * Variáveis de Ambiente Necessárias:
 *   DATABASE_URL - URL de conexão com PostgreSQL
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { users } from "../drizzle/schema.ts";
import { eq } from "drizzle-orm";
import dotenv from "dotenv";

// Carregar variáveis de ambiente
dotenv.config();

// ============================================
// CONFIGURAÇÃO DO ADMIN DONO
// ============================================
const OWNER_CONFIG = {
  openId: "admin@notifique.me",
  name: "Administrador do Sistema",
  email: "admin@notifique.me",
  loginMethod: "email",
  role: "owner",
  tenantId: null  // Owner não pertence a nenhum tenant
};

// ============================================
// FUNÇÕES AUXILIARES
// ============================================

function validateEnvironment() {
  if (!process.env.DATABASE_URL) {
    console.error("❌ ERRO: DATABASE_URL não está definida nas variáveis de ambiente!");
    console.error("   Configure DATABASE_URL no arquivo .env");
    console.error("   Exemplo: DATABASE_URL=postgresql://user:password@localhost:5432/notifique_me");
    process.exit(1);
  }
}

async function createOwner() {
  console.log("🚀 Inicializando banco de dados com Admin Dono...\n");
  
  validateEnvironment();
  
  let client;
  try {
    // Conectar ao banco de dados
    console.log("📡 Conectando ao banco de dados...");
    client = postgres(process.env.DATABASE_URL, {
      ssl: { rejectUnauthorized: false }
    });
    const db = drizzle(client);
    console.log("✅ Conexão estabelecida com sucesso!\n");
    
    // Verificar se o Owner já existe
    console.log("🔍 Verificando se o Admin Dono já existe...");
    const existingUsers = await db
      .select()
      .from(users)
      .where(eq(users.openId, OWNER_CONFIG.openId))
      .limit(1);
    
    if (existingUsers.length > 0) {
      const existingUser = existingUsers[0];
      
      // Verificar se já é Owner
      if (existingUser.role === "owner") {
        console.log("ℹ️  Admin Dono já existe no banco de dados:");
        console.log(`   ID: ${existingUser.id}`);
        console.log(`   Nome: ${existingUser.name}`);
        console.log(`   Email: ${existingUser.email}`);
        console.log(`   Role: ${existingUser.role}`);
        console.log("\n✅ Nenhuma ação necessária. Admin Dono já está configurado corretamente!\n");
        return;
      }
      
      // Atualizar usuário existente para Owner
      console.log("⚠️  Usuário existe mas não é Owner. Atualizando...");
      await db
        .update(users)
        .set({
          role: "owner",
          tenantId: null,
          name: OWNER_CONFIG.name,
          email: OWNER_CONFIG.email,
          updatedAt: new Date()
        })
        .where(eq(users.id, existingUser.id));
      
      console.log("✅ Usuário atualizado para Owner com sucesso!");
      console.log(`   ID: ${existingUser.id}`);
      console.log(`   Nome: ${OWNER_CONFIG.name}`);
      console.log(`   Email: ${OWNER_CONFIG.email}`);
      console.log(`   Role: owner\n`);
      return;
    }
    
    // Criar novo Owner
    console.log("➕ Admin Dono não encontrado. Criando novo usuário...");
    const result = await db.insert(users).values({
      openId: OWNER_CONFIG.openId,
      name: OWNER_CONFIG.name,
      email: OWNER_CONFIG.email,
      loginMethod: OWNER_CONFIG.loginMethod,
      role: OWNER_CONFIG.role,
      tenantId: OWNER_CONFIG.tenantId,
      lastSignedIn: new Date()
    });
    
    console.log("✅ Admin Dono criado com sucesso!");
    console.log(`   Nome: ${OWNER_CONFIG.name}`);
    console.log(`   Email: ${OWNER_CONFIG.email}`);
    console.log(`   OpenID: ${OWNER_CONFIG.openId}`);
    console.log(`   Role: ${OWNER_CONFIG.role}`);
    console.log(`   TenantID: ${OWNER_CONFIG.tenantId} (Admin Global)\n`);
    
    console.log("🎉 Inicialização concluída com sucesso!\n");
    console.log("📋 Próximos passos:");
    console.log("   1. Faça login com o email: admin@notifique.me");
    console.log("   2. Acesse a 'Área do Dono' no menu");
    console.log("   3. Crie Admins para gerenciar tenants");
    console.log("   4. Crie Usuários para usar as notificações\n");
    
  } catch (error) {
    console.error("\n❌ ERRO ao inicializar o banco de dados:");
    console.error(error);
    console.error("\n🔧 Possíveis soluções:");
    console.error("   1. Verifique se o banco de dados está rodando");
    console.error("   2. Confirme se DATABASE_URL está correta");
    console.error("   3. Execute as migrações: npm run db:push");
    console.error("   4. Verifique as permissões do usuário do banco\n");
    process.exit(1);
  } finally {
    // Fechar conexão
    if (client) {
      await client.end();
    }
  }
}

// ============================================
// EXECUÇÃO
// ============================================

createOwner()
  .then(() => {
    console.log("✨ Script finalizado com sucesso!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("💥 Erro fatal:", error);
    process.exit(1);
  });
