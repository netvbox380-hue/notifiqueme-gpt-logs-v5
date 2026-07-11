// Script para inicializar o banco de dados MySQL com apenas o Admin Dono
// Execução: node scripts/seed-database.mjs

import 'dotenv/config';
import { getDb } from '../server/db.js';
import { users, tenants } from '../drizzle/schema.js';

async function seedDatabase() {
  console.log('🚀 Inicializando banco de dados com Admin Dono...\n');

  try {
    const db = await getDb();
    if (!db) {
      throw new Error('Banco de dados não disponível');
    }

    // Criar tenant padrão (para o owner)
    console.log('📊 Criando tenant padrão...');
    const [tenantResult] = await db.insert(tenants).values({
      name: 'Sistema Principal',
      slug: 'sistema-principal',
      status: 'active',
      plan: 'enterprise',
      subscriptionExpiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 ano
    });

    const tenantId = Number(tenantResult.insertId);
    console.log(`✅ Tenant criado com ID: ${tenantId}\n`);

    // Criar apenas o Admin Dono
    console.log('👤 Criando Admin Dono...');
    const ownerData = {
      openId: 'admin@notifique.me',
      name: 'Administrador do Sistema',
      email: 'admin@notifique.me',
      loginMethod: 'email',
      role: 'owner',
      tenantId: null, // Owner não tem tenant específico
    };

    const [userResult] = await db.insert(users).values(ownerData);
    const userId = Number(userResult.insertId);
    console.log(`✅ Admin Dono criado com ID: ${userId}\n`);

    console.log('✨ Banco de dados inicializado com sucesso!\n');
    console.log('📋 Dados criados:');
    console.log(`  • 1 Tenant (Sistema Principal)`);
    console.log(`  • 1 Admin Dono\n`);
    console.log('🔐 Credenciais do Admin Dono:');
    console.log(`  Email: ${ownerData.email}`);
    console.log(`  Função: ${ownerData.role.toUpperCase()}\n`);
    console.log('💡 O Admin Dono pode criar:');
    console.log(`  • Novos Admins (para gerenciar tenants)`);
    console.log(`  • Novos Usuários (para usar as notificações)`);
    console.log(`  • Novos Tenants (clientes/empresas)\n`);

    process.exit(0);
  } catch (error) {
    console.error('\n❌ Erro ao inicializar banco de dados:', error.message);
    process.exit(1);
  }
}

seedDatabase();
