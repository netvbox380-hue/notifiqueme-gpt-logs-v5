// client/src/lib/simpleRichText.ts
//
// Formatação minimalista e segura pra texto de admin exibido a usuários finais:
// suporta **negrito** e *itálico*, nada além disso. Não é markdown completo de
// propósito — menos superfície pra erro de digitação e zero risco de HTML/script
// injetado, porque escapamos tudo antes de aplicar as duas transformações.

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Converte um texto com marcações **negrito** e *itálico* em HTML seguro
 * (apenas <strong>, <em> e quebras de linha). Sempre escapa o texto original
 * primeiro, então não há como injetar tags arbitrárias mesmo que o texto
 * salvo contenha `<`/`>`.
 */
export function renderSimpleRichText(raw: string | null | undefined): string {
  const text = String(raw ?? "");
  if (!text.trim()) return "";

  let escaped = escapeHtml(text);

  // **negrito** (não guloso, não cruza linhas em branco duplas)
  escaped = escaped.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  // *itálico* (depois do negrito, pra não conflitar com **)
  escaped = escaped.replace(/\*([^*\n]+)\*/g, "<em>$1</em>");

  // quebras de linha viram <br/>
  escaped = escaped.replace(/\n/g, "<br/>");

  return escaped;
}
