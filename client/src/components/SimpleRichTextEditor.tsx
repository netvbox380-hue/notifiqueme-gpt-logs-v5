import React, { useRef } from "react";
import { Bold, Italic } from "lucide-react";
import { renderSimpleRichText } from "@/lib/simpleRichText";

type Props = {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  maxLength?: number;
};

/**
 * Caixa de texto com botões de Negrito/Itálico (aplicam marcadores no trecho
 * selecionado) + prévia ao vivo de como vai renderizar pro usuário final.
 * Sem lib de rich-text pesada — é só marcação simples, sanitizada no render
 * (ver client/src/lib/simpleRichText.ts).
 */
export default function SimpleRichTextEditor({ value, onChange, placeholder, maxLength = 2000 }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // ✅ Defesa extra: nunca deixa `value` undefined/null quebrar o componente,
  // mesmo que algum outro lugar do código esqueça de inicializar o campo.
  const safeValue = value ?? "";

  const wrapSelection = (marker: string) => {
    const el = textareaRef.current;
    if (!el) return;

    const start = el.selectionStart ?? safeValue.length;
    const end = el.selectionEnd ?? safeValue.length;
    const selected = safeValue.slice(start, end) || "texto";

    const next = safeValue.slice(0, start) + marker + selected + marker + safeValue.slice(end);
    onChange(next.slice(0, maxLength));

    // Restaura o foco e seleciona o trecho recém-formatado
    requestAnimationFrame(() => {
      el.focus();
      const newStart = start + marker.length;
      const newEnd = newStart + selected.length;
      el.setSelectionRange(newStart, newEnd);
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => wrapSelection("**")}
          className="rounded-md border px-2 py-1 text-xs font-semibold hover:bg-muted transition inline-flex items-center gap-1"
          title="Negrito"
        >
          <Bold className="w-3.5 h-3.5" />
          Negrito
        </button>
        <button
          type="button"
          onClick={() => wrapSelection("*")}
          className="rounded-md border px-2 py-1 text-xs italic hover:bg-muted transition inline-flex items-center gap-1"
          title="Itálico"
        >
          <Italic className="w-3.5 h-3.5" />
          Itálico
        </button>
        <span className="ml-auto text-[11px] text-muted-foreground">
          {safeValue.length}/{maxLength}
        </span>
      </div>

      <textarea
        ref={textareaRef}
        value={safeValue}
        onChange={(e) => onChange(e.target.value.slice(0, maxLength))}
        placeholder={placeholder}
        rows={4}
        className="w-full rounded-lg border-2 bg-background p-3 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-ring"
      />

      {safeValue.trim() ? (
        <div className="space-y-1">
          <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
            Prévia (como o usuário vai ver)
          </div>
          <div
            className="rounded-lg border bg-muted/30 p-3 text-sm leading-relaxed"
            dangerouslySetInnerHTML={{ __html: renderSimpleRichText(safeValue) }}
          />
        </div>
      ) : null}
    </div>
  );
}
