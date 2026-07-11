import { useEffect, useMemo, useRef, useState } from "react";
import { Expand, Play, X } from "lucide-react";
import { trpc } from "@/lib/trpc";

function isUploadKey(value?: string) {
  return Boolean(value && value.startsWith("uploads/"));
}

function isVideo(url?: string) {
  if (!url) return false;
  const u = url.toLowerCase();
  return (
    u.includes(".mp4") ||
    u.includes(".webm") ||
    u.includes(".ogg") ||
    u.includes(".mov") ||
    u.includes(".m4v")
  );
}

function buildMediaProxyUrl(fileKey: string) {
  return `/api/media?fileKey=${encodeURIComponent(fileKey)}`;
}

export default function MediaViewer({
  url,
  title,
  className,
}: {
  url?: string;
  title?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [inlineControls, setInlineControls] = useState(false);
  const [isInlinePlaying, setIsInlinePlaying] = useState(false);
  const [isInlineMuted] = useState(true);

  const inlineVideoRef = useRef<HTMLVideoElement | null>(null);
  const modalVideoRef = useRef<HTMLVideoElement | null>(null);

  const fileKey = isUploadKey(url) ? (url as string) : undefined;
  const isUploadMedia = Boolean(fileKey);
  const isUploadVideo = Boolean(fileKey && isVideo(fileKey));

  const signedUrlQuery = trpc.upload.getFileUrl.useQuery(
    { fileKey: fileKey ?? "uploads/__invalid__" },
    {
      enabled: Boolean(fileKey) && !isUploadVideo,
      staleTime: 1000 * 60 * 5,
      refetchOnWindowFocus: false,
    }
  );

  const resolvedUrl = useMemo(() => {
    if (isUploadVideo && fileKey) {
      return buildMediaProxyUrl(fileKey);
    }

    if (isUploadMedia && fileKey) {
      return signedUrlQuery.data?.url;
    }

    return url;
  }, [fileKey, isUploadMedia, isUploadVideo, signedUrlQuery.data?.url, url]);

  const video = isUploadVideo || isVideo(resolvedUrl);

  const playInlineVideo = () => {
    const el = inlineVideoRef.current;
    if (!el) return;

    setInlineControls(true);
    el.muted = isInlineMuted;

    const playPromise = el.play();
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch(() => {
        setInlineControls(true);
      });
    }
  };

  const pauseInlineVideo = () => {
    const el = inlineVideoRef.current;
    if (!el) return;
    el.pause();
  };

  const toggleInlineVideo = () => {
    const el = inlineVideoRef.current;
    if (!el) return;

    if (el.paused || el.ended) {
      playInlineVideo();
    } else {
      pauseInlineVideo();
    }
  };

  useEffect(() => {
    if (!open || !video) return;
    const el = modalVideoRef.current;
    if (!el) return;

    el.currentTime = 0;
    el.muted = false;

    const p = el.play();
    if (p && typeof p.catch === "function") {
      p.catch(() => {
        // autoplay com som pode ser bloqueado pelo navegador
      });
    }
  }, [open, video]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  useEffect(() => {
    if (open) return;

    const el = modalVideoRef.current;
    if (el) {
      try {
        el.pause();
      } catch {}
    }
  }, [open]);

  if (isUploadMedia && !resolvedUrl) {
    if (signedUrlQuery.isError) {
      return (
        <div className="mt-3 text-sm text-muted-foreground">
          Não foi possível carregar o anexo.
        </div>
      );
    }

    return <div className="h-28 w-28 rounded-md bg-white/5" />;
  }

  if (!resolvedUrl) return null;

  return (
    <>
      <div
        className={[
          "mt-3 w-full rounded-xl overflow-hidden bg-black/20 relative",
          className ?? "",
        ].join(" ")}
      >
        {video ? (
          <div className="relative w-full flex items-center justify-center">
            <video
              ref={inlineVideoRef}
              src={resolvedUrl}
              className="w-full max-h-[420px] object-contain bg-black"
              preload="metadata"
              playsInline
              muted={isInlineMuted}
              controls={inlineControls}
              onClick={(e) => {
                e.stopPropagation();
                toggleInlineVideo();
              }}
              onPlay={() => setIsInlinePlaying(true)}
              onPause={() => setIsInlinePlaying(false)}
              onEnded={() => setIsInlinePlaying(false)}
            />

            {!inlineControls && !isInlinePlaying && (
              <button
                type="button"
                className="absolute inset-0 flex items-center justify-center"
                onClick={(e) => {
                  e.stopPropagation();
                  playInlineVideo();
                }}
                aria-label="Reproduzir vídeo"
              >
                <div className="rounded-full bg-black/55 p-3 ring-1 ring-white/30">
                  <Play className="w-8 h-8 text-white" />
                </div>
              </button>
            )}

            <button
              type="button"
              className="absolute top-2 right-2 rounded-full bg-black/60 p-2 text-white hover:bg-black/75"
              onClick={(e) => {
                e.stopPropagation();
                setOpen(true);
              }}
              aria-label="Expandir vídeo"
            >
              <Expand className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="block w-full cursor-zoom-in"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(true);
            }}
            aria-label={title ? `Abrir imagem: ${title}` : "Abrir imagem"}
          >
            <img
              src={resolvedUrl}
              alt={title || "Anexo"}
              className="w-full max-h-[420px] object-contain"
              loading="lazy"
            />
          </button>
        )}
      </div>

      {open && (
        <div
          className="fixed inset-0 z-[9999] bg-black/95 flex items-center justify-center"
          onClick={() => setOpen(false)}
        >
          <button
            type="button"
            className="absolute top-4 right-4 text-white bg-black/50 rounded-full p-2"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
            }}
            aria-label="Fechar"
          >
            <X className="w-6 h-6" />
          </button>

          <div
            className="w-full h-full flex items-center justify-center p-3 sm:p-6"
            onClick={(e) => e.stopPropagation()}
          >
            {video ? (
              <video
                ref={modalVideoRef}
                src={resolvedUrl}
                className="max-w-full max-h-full object-contain bg-black rounded-lg"
                controls
                playsInline
              />
            ) : (
              <img
                src={resolvedUrl}
                alt={title || "Anexo"}
                className="max-w-full max-h-full object-contain"
              />
            )}
          </div>
        </div>
      )}
    </>
  );
}
