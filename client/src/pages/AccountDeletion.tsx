/**
 * Página pública de Exclusão de Conta e Dados.
 *
 * ⚠️ Exigida pelo Google Play (Data Safety) quando o app possui contas de
 * usuário. Precisa: (1) citar o nome do app/desenvolvedor, (2) explicar os
 * passos para solicitar exclusão, (3) detalhar quais dados são excluídos
 * e por quanto tempo dados residuais podem ficar retidos.
 */
export default function AccountDeletion() {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-6 py-12 prose prose-sm">
        <h1 className="text-2xl font-semibold mb-2">Exclusão de Conta e Dados — Notifique-me</h1>
        <p className="text-sm text-muted-foreground mb-8">Última atualização: 19/06/2026</p>

        <section className="space-y-4 text-sm leading-relaxed">
          <p>
            O <strong>Notifique-me</strong> é um sistema de notificações onde as
            contas de usuário final são criadas pelo administrador da
            organização (tenant) à qual você pertence — não há autocadastro
            aberto. Por isso, a exclusão de conta é feita através do
            administrador, mas você pode solicitar diretamente a nós também.
          </p>

          <h2 className="text-lg font-semibold mt-6">Como solicitar a exclusão</h2>
          <ol className="list-decimal pl-5 space-y-1">
            <li>
              Envie um e-mail para{" "}
              <a href="mailto:ninfoboyn@gmail.com" className="underline">
                ninfoboyn@gmail.com
              </a>{" "}
              com o assunto "Exclusão de conta — Notifique-me".
            </li>
            <li>Informe seu nome de usuário (ou e-mail cadastrado) e o nome da organização/empresa à qual sua conta pertence.</li>
            <li>
              Vamos confirmar sua identidade e excluir a conta em até{" "}
              <strong>5 dias úteis</strong>.
            </li>
          </ol>
          <p>
            Alternativamente, você pode pedir diretamente ao administrador da
            sua organização — ele tem permissão para excluir sua conta a
            qualquer momento dentro do painel administrativo.
          </p>

          <h2 className="text-lg font-semibold mt-6">O que é excluído</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>Nome, e-mail e credenciais de login.</li>
            <li>Token de inscrição para notificações push.</li>
            <li>Vínculo da conta com a organização (tenant).</li>
          </ul>

          <h2 className="text-lg font-semibold mt-6">O que pode ser retido por mais tempo</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>
              Registros de notificações já enviadas a você podem permanecer no
              histórico da organização por até <strong>30 dias</strong> após a
              exclusão da conta, prazo padrão de retenção do sistema, antes de
              serem removidos automaticamente.
            </li>
            <li>
              Registros mínimos necessários para cumprimento de obrigação
              legal ou prevenção de fraude, quando aplicável.
            </li>
          </ul>

          <h2 className="text-lg font-semibold mt-6">Contato</h2>
          <p>Dúvidas sobre exclusão de dados: ninfoboyn@gmail.com.</p>
        </section>
      </div>
    </div>
  );
}
