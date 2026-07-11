/**
 * Página pública de Política de Privacidade.
 *
 * ⚠️ IMPORTANTE: o Google Play Console EXIGE uma URL pública de política de
 * privacidade (sem login) para publicar o app — tanto no formulário do app
 * quanto na seção "Data safety" (Segurança dos dados).
 *
 * Dados de contato/responsável já preenchidos (Fábio Aquino /
 * ninfoboyn@gmail.com). Revise o restante do texto com um advogado/DPO
 * antes de publicar — isso aqui não é aconselhamento jurídico.
 */
export default function Privacy() {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-6 py-12 prose prose-sm">
        <h1 className="text-2xl font-semibold mb-2">Política de Privacidade</h1>
        <p className="text-sm text-muted-foreground mb-8">
          Última atualização: 19/06/2026
        </p>

        <section className="space-y-4 text-sm leading-relaxed">
          <p>
            Esta Política de Privacidade descreve como o <strong>Notifique-me</strong>{" "}
            ("nós", "aplicativo") coleta, usa e protege os dados de quem utiliza
            o sistema, seja pelo painel administrativo ou pelo aplicativo do
            destinatário de notificações.
          </p>

          <h2 className="text-lg font-semibold mt-6">1. Quem somos</h2>
          <p>
            Responsável pelo tratamento de dados: Fábio Aquino,
            CPF 065.185.854-20, contato: ninfoboyn@gmail.com.
          </p>

          <h2 className="text-lg font-semibold mt-6">2. Dados que coletamos</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>Identificador de login (usuário ou e-mail) e senha (armazenada com hash, nunca em texto puro).</li>
            <li>Nome e e-mail, quando informados.</li>
            <li>Conteúdo das notificações enviadas e recebidas (título, mensagem, imagens/vídeos anexados).</li>
            <li>Token de inscrição push (necessário para entregar notificações no dispositivo).</li>
            <li>Registros técnicos de entrega/leitura das notificações (data, status, se foi lida).</li>
            <li>Endereço IP e dados básicos de uso, para segurança e limitação de abuso (rate limiting).</li>
          </ul>

          <h2 className="text-lg font-semibold mt-6">3. Como usamos os dados</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>Autenticar o acesso e manter a sessão de login.</li>
            <li>Entregar as notificações ao destinatário correto (isolamento por tenant/organização).</li>
            <li>Gerar estatísticas de entrega e leitura para o administrador do seu próprio tenant.</li>
            <li>Prevenir abuso (limites de envio, proteção contra força bruta no login).</li>
          </ul>

          <h2 className="text-lg font-semibold mt-6">4. Compartilhamento</h2>
          <p>
            Não vendemos dados pessoais. Dados podem ser processados por
            provedores de infraestrutura usados para operar o serviço
            (hospedagem, banco de dados, armazenamento de arquivos e envio de
            notificações push), exclusivamente para esse fim.
          </p>

          <h2 className="text-lg font-semibold mt-6">5. Retenção</h2>
          <p>
            Notificações e registros de entrega são mantidos por até
            30 dias e depois removidos automaticamente,
            salvo obrigação legal de guarda por período maior.
          </p>

          <h2 className="text-lg font-semibold mt-6">6. Seus direitos</h2>
          <p>
            Você pode solicitar acesso, correção ou exclusão dos seus dados
            entrando em contato com o administrador da sua organização ou com
            ninfoboyn@gmail.com. Usuários finais não se cadastram
            sozinhos: contas são criadas pelo administrador do seu tenant, que
            também pode excluir sua conta e seus dados a qualquer momento.
          </p>

          <h2 className="text-lg font-semibold mt-6">7. Permissão de notificações</h2>
          <p>
            O aplicativo solicita permissão de notificações para poder
            entregar avisos enviados pelo administrador da sua organização.
            Você pode revogar essa permissão nas configurações do seu
            dispositivo a qualquer momento; isso não impede o uso do app, mas
            as mensagens passarão a aparecer apenas dentro da caixa de
            entrada do app, sem alerta push.
          </p>

          <h2 className="text-lg font-semibold mt-6">8. Contato</h2>
          <p>Dúvidas sobre privacidade: ninfoboyn@gmail.com.</p>
        </section>
      </div>
    </div>
  );
}
