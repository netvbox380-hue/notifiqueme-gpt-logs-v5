/**
 * Script para corrigir o role do Owner no banco de dados
 * Garante que apenas o Admin Dono tenha role "owner"
 * 
 * Uso: node scripts/fix-owner-role.mjs
 */

import 'dotenv/config';
import mysql from 'mysql2/promise';

async function fixOwnerRole() {
  const ownerEmail = 'admin@notifique.me';
  
  console.log(`\n🔧 Corrigindo role para o Admin Dono: ${ownerEmail}\n`);

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('❌ DATABASE_URL não está configurado no arquivo .env');
    process.exit(1);
  }

  // Parse DATABASE_URL
  const url = new URL(databaseUrl);
  const connection = await mysql.createConnection({
    host: url.hostname,
    port: parseInt(url.port) || 3306,
    user: url.username,
    password: url.password,
    database: url.pathname.slice(1),
  });

  try {
    // Verificar se o usuário existe
    const [rows] = await connection.execute(
      'SELECT id, openId, email, name, role FROM users WHERE openId = ? OR email = ?',
      [ownerEmail, ownerEmail]
    );

    if (rows.length === 0) {
      console.log('⚠️  Admin Dono não encontrado no banco de dados.');
      console.log('   Criando novo Admin Dono...');
      
      // Criar o usuário como owner
      console.log('\n📝 Criando Admin Dono...');
      await connection.execute(
        'INSERT INTO users (openId, email, name, role, createdAt, updatedAt, lastSignedIn) VALUES (?, ?, ?, ?, NOW(), NOW(), NOW())',
        [ownerEmail, ownerEmail, 'Administrador do Sistema', 'owner']
      );
      console.log('✅ Admin Dono criado com sucesso!');
    } else {
      const user = rows[0];
      console.log('📋 Admin encontrado:');
      console.log(`   ID: ${user.id}`);
      console.log(`   OpenID: ${user.openId}`);
      console.log(`   Email: ${user.email}`);
      console.log(`   Nome: ${user.name}`);
      console.log(`   Role atual: ${user.role}`);

      if (user.role === 'owner') {
        console.log('\n✅ O Admin já tem role "owner"! Nenhuma alteração necessária.');
      } else {
        // Atualizar o role para owner
        console.log('\n🔄 Atualizando role para "owner"...');
        await connection.execute(
          'UPDATE users SET role = ? WHERE id = ?',
          ['owner', user.id]
        );
        console.log('✅ Role atualizado com sucesso!');
        
        // Verificar a atualização
        const [updated] = await connection.execute(
          'SELECT role FROM users WHERE id = ?',
          [user.id]
        );
        console.log(`   Novo role: ${updated[0].role}`);
      }
    }

    // Remover qualquer outro usuário com role "owner" ou "superadmin"
    console.log('\n🧹 Limpando outros admins com role "owner" ou "superadmin"...');
    const [otherAdmins] = await connection.execute(
      'SELECT id, email, role FROM users WHERE (role = "owner" OR role = "superadmin") AND email != ?',
      [ownerEmail]
    );

    if (otherAdmins.length > 0) {
      console.log(`   Encontrados ${otherAdmins.length} admin(s) extra(s):`);
      for (const admin of otherAdmins) {
        console.log(`   - ID: ${admin.id}, Email: ${admin.email}, Role: ${admin.role}`);
        // Atualizar para "user" ou deletar
        await connection.execute(
          'UPDATE users SET role = ? WHERE id = ?',
          ['user', admin.id]
        );
        console.log(`     ✅ Role alterado para "user"`);
      }
    } else {
      console.log('   ✅ Nenhum admin extra encontrado.');
    }

    console.log('\n========================================');
    console.log('🎉 Processo concluído!');
    console.log('========================================');
    console.log('\n📌 Status Final:');
    console.log(`   ✅ Admin Dono: ${ownerEmail} com role "owner"`);
    console.log('   ✅ Todos os outros admins foram removidos');
    console.log('\n💡 O Admin Dono pode criar:');
    console.log('   • Novos Admins (para gerenciar tenants)');
    console.log('   • Novos Usuários (para usar as notificações)');
    console.log('   • Novos Tenants (clientes/empresas)\n');

  } catch (error) {
    console.error('❌ Erro ao executar script:', error.message);
    process.exit(1);
  } finally {
    await connection.end();
  }
}

fixOwnerRole();
