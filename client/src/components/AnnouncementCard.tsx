import React from "react";
import { Info } from "lucide-react";
import { renderSimpleRichText } from "@/lib/simpleRichText";

type Props = {
  body: string;
};

/**
 * Card informativo persistente e personalizado, definido pelo admin pra esse
 * usuário específico (ex: "Troque o óleo em 12/07/2027"). Diferente do
 * PushActivationBanner, este não some sozinho — fica até o admin desligar
 * ou apagar o texto.
 */
export default function AnnouncementCard({ body }: Props) {
  if (!body || !body.trim()) return null;

  return (
    <div className="flex items-start gap-2 rounded-xl border border-sky-500/30 bg-sky-500/10 px-4 py-3 mb-4">
      <Info className="w-4 h-4 mt-0.5 shrink-0 text-sky-500" />
      <div
        className="text-sm leading-relaxed"
        dangerouslySetInnerHTML={{ __html: renderSimpleRichText(body) }}
      />
    </div>
  );
}
