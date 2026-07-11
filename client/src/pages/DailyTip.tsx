/**
 * Página pública "Dica do dia".
 *
 * Pensada pra ser o link que você manda todo dia pros testadores do Teste
 * Fechado (Google Play): a URL é sempre a mesma, mas o conteúdo mudasozinho
 * a cada dia (baseado na data real, não em estado salvo) — assim a mesma
 * mensagem/link funciona pra todos os 14 dias, sem trabalho manual.
 *
 * Como funciona: cada dia do calendário escolhe um item da lista TIPS de
 * forma determinística (dia do ano % tamanho da lista) — não depende de
 * login, banco de dados nem nada externo, só a data do dispositivo.
 */

const TIPS: { title: string; body: string }[] = [
  {
    title: "Você sabia?",
    body: "No Notifique-me, cada notificação mostra se foi lida ou não — diferente do WhatsApp, onde lista de transmissão não te dá essa informação.",
  },
  {
    title: "Dica de hoje",
    body: "Você pode agendar uma notificação pra ser enviada automaticamente todo dia, toda semana ou todo mês — sem precisar lembrar de mandar manualmente.",
  },
  {
    title: "Curiosidade",
    body: "Diferente de lista de transmissão do WhatsApp (limite de 256 contatos), o Notifique-me não tem limite de destinatários por envio.",
  },
  {
    title: "Você sabia?",
    body: "É possível organizar seus contatos em grupos (ex: clientes VIP, inadimplentes) e mandar notificações só pra um grupo específico.",
  },
  {
    title: "Dica de hoje",
    body: "Toda notificação enviada fica registrada no Histórico — você sempre pode conferir o que foi mandado e quando.",
  },
  {
    title: "Curiosidade",
    body: "O ícone do app pode mostrar um número (badge) com a quantidade de mensagens não lidas, igual outros apps de mensagem.",
  },
  {
    title: "Dica de hoje",
    body: "Se um link aparecer dentro de uma notificação, ele agora é clicável — toca e abre direto, sem precisar copiar e colar.",
  },
  {
    title: "Você sabia?",
    body: "O Notifique-me funciona mesmo com o app fechado: a notificação chega igual a um aplicativo de mensagens normal.",
  },
  {
    title: "Obrigado por testar!",
    body: "Sua participação nesses dias de teste ajuda muito antes do lançamento oficial. Qualquer coisa estranha, é só avisar.",
  },
];

function getTipOfTheDay() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  const diff = now.getTime() - start.getTime();
  const dayOfYear = Math.floor(diff / (1000 * 60 * 60 * 24));
  const index = dayOfYear % TIPS.length;
  return TIPS[index];
}

export default function DailyTip() {
  const tip = getTipOfTheDay();
  const todayLabel = new Date().toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "long",
  });

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-6">
      <div className="max-w-md w-full text-center space-y-6">
        <img
          src="/icon-512.png"
          alt="Notifique-me"
          className="h-16 w-16 rounded-xl mx-auto"
        />

        <div className="space-y-2">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            {todayLabel}
          </p>
          <h1 className="text-2xl font-bold">{tip.title}</h1>
        </div>

        <p className="text-base leading-relaxed text-muted-foreground">
          {tip.body}
        </p>

        <p className="text-xs text-muted-foreground pt-6">
          Notifique-me · conteúdo novo todos os dias
        </p>
      </div>
    </div>
  );
}
