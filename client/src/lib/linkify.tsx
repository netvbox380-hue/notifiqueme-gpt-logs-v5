// client/src/lib/linkify.tsx
import React from "react";

/**
 * Detecta URLs (http/https/www) dentro de um texto puro e devolve um array
 * de nodes React, transformando cada URL encontrada em um link clicável
 * (abre em nova aba). O resto do texto permanece igual, intacto.
 *
 * Por quê isso existe separado: o conteúdo da notificação é salvo e exibido
 * como texto puro (sem HTML), então um link dentro da mensagem nunca virava
 * `<a>` — ficava ali, branco, sem clique nenhum.
 *
 * Implementação: usa split() com regex de grupo capturado — os índices
 * ímpares do array resultante são sempre as URLs casadas, e os pares são o
 * texto normal em volta. Isso evita qualquer problema de "estado" de regex
 * global reaproveitada entre chamadas (lastIndex), que é uma pegadinha
 * clássica de regex com flag /g em JS.
 */
const URL_REGEX = /(https?:\/\/[^\s]+|www\.[^\s]+)/gi;

export function linkifyText(text: string): React.ReactNode[] {
  if (!text) return [text];

  const parts = text.split(URL_REGEX);

  return parts.map((part, i) => {
    // índices ímpares = URL casada (por causa do grupo capturado no split)
    const isUrl = i % 2 === 1;

    if (!isUrl || !part) {
      return <React.Fragment key={i}>{part}</React.Fragment>;
    }

    // remove pontuação final comum que não faz parte da URL (. , ) etc.)
    const trailingMatch = part.match(/([.,;:!?)\]]+)$/);
    const trailing = trailingMatch ? trailingMatch[1] : "";
    const cleanUrl = trailing ? part.slice(0, -trailing.length) : part;

    const href = cleanUrl.toLowerCase().startsWith("http")
      ? cleanUrl
      : `https://${cleanUrl}`;

    return (
      <React.Fragment key={i}>
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="underline text-primary break-all"
        >
          {cleanUrl}
        </a>
        {trailing}
      </React.Fragment>
    );
  });
}
