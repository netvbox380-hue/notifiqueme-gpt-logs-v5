import { useState } from "react";
import { trpc } from "../lib/trpc";
import { toast } from "sonner";

export interface UploadProgress {
  loaded: number;
  total: number;
  percentage: number;
}

export interface UploadResult {
  success: boolean;
  fileId?: number;
  publicUrl?: string; // ✅ preview imediato (pode ser signed)
  fileKey?: string; // ✅ permanente (uploads/...)
  error?: string;
}

type UploadOpts = {
  manageState?: boolean;
  showToast?: boolean;
};

export function useFileUpload() {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<UploadProgress>({
    loaded: 0,
    total: 0,
    percentage: 0,
  });

  const uploadMutation = trpc.upload.upload.useMutation();
  const createPutUrlMutation = trpc.upload.createPutUrl.useMutation();
  const utils = trpc.useUtils();

  const fileToBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = (error) => reject(error);
    });

  const normalizeFileId = (val: unknown): number | undefined => {
    if (val === null || val === undefined) return undefined;
    if (typeof val === "number") return val;
    if (typeof val === "bigint") return Number(val);
    if (typeof val === "string") {
      const n = Number(val);
      return Number.isFinite(n) ? n : undefined;
    }
    return undefined;
  };

  const uploadFileInternal = async (
    file: File,
    relatedNotificationId?: number,
    tenantId?: number,
    opts: UploadOpts = {}
  ): Promise<UploadResult> => {
    const manageState = opts.manageState !== false;
    const showToast = opts.showToast !== false;

    if (manageState) {
      setUploading(true);
      setProgress({ loaded: 0, total: file.size, percentage: 5 });
    }

    try {
      const allowedTypes = [
        "image/jpeg",
        "image/png",
        "image/gif",
        "image/webp",
        "video/mp4",
        "video/webm",
        "video/quicktime",
        "audio/mpeg",
        "audio/wav",
        "audio/ogg",
      ];

      if (!allowedTypes.includes(file.type)) {
        if (showToast) toast.error("Tipo de arquivo não permitido");
        return { success: false, error: "Tipo de arquivo não permitido" };
      }

      const isImage = file.type.startsWith("image/");
      const isVideo = file.type.startsWith("video/");

      const maxSize = isImage
        ? 20 * 1024 * 1024
        : isVideo
          ? 100 * 1024 * 1024
          : 100 * 1024 * 1024;

      if (file.size > maxSize) {
        const label = isImage
          ? "20MB (imagens)"
          : isVideo
            ? "100MB (vídeos)"
            : "100MB";
        if (showToast) toast.error(`Arquivo muito grande (máximo ${label})`);
        return { success: false, error: "Arquivo muito grande" };
      }

      if (manageState) setProgress((p) => ({ ...p, percentage: 20 }));

      // ✅ Evita travar/estourar limites do Netlify Dev/Functions
      // - base64 em JSON cresce ~33% e pode causar 413/Stream body too big
      // - no Netlify Dev (porta 8888) isso é bem frequente com múltiplos uploads
      const isBrowser = typeof window !== "undefined";
      const hostname = isBrowser ? window.location.hostname : "";
      const isLocalHost = hostname === "localhost" || hostname === "127.0.0.1";
      const isNetlifyDev =
        isBrowser &&
        (window.location.port === "8888" ||
          window.location.pathname.startsWith("/.netlify"));

      const isProductionHost = isBrowser && !isLocalHost;

      const shouldUseDirectPut =
        // acima de 512KB já evita estouro por base64/JSON em produção
        file.size > 512 * 1024 ||
        // vídeos e áudios sempre via PUT
        isVideo ||
        file.type.startsWith("audio/") ||
        // netlify dev e qualquer produção/custom domain: preferir PUT
        isNetlifyDev ||
        isProductionHost;

      let result: any;

      const tryUploadBase64 = async () => {
        const base64Data = await fileToBase64(file);
        if (manageState) setProgress((p) => ({ ...p, percentage: 60 }));
        return uploadMutation.mutateAsync({
          filename: file.name,
          fileData: base64Data,
          mimeType: file.type,
          relatedNotificationId,
          tenantId,
        });
      };

      if (shouldUseDirectPut) {
        try {
          const signed = await createPutUrlMutation.mutateAsync({
            filename: file.name,
            mimeType: file.type,
            fileSize: file.size,
            relatedNotificationId,
            tenantId,
          });

          if (manageState) setProgress((p) => ({ ...p, percentage: 45 }));

          const putUrl = (signed as any)?.putUrl;
          const fileKey = (signed as any)?.fileKey;
          const fileId = normalizeFileId((signed as any)?.fileId);

          if (!putUrl || !fileKey) {
            throw new Error("Falha ao obter URL de upload");
          }

          let putRes: Response;
          try {
            putRes = await fetch(putUrl, {
              method: "PUT",
              headers: {
                "Content-Type": file.type,
              },
              body: file,
            });
          } catch (e) {
            // Erros de CORS geralmente aparecem como TypeError no fetch
            const msg =
              e instanceof Error && e.message
                ? e.message
                : "Falha de rede/CORS no upload direto";
            throw new Error(msg);
          }

          if (!putRes.ok) {
            const errorText = await putRes.text().catch(() => "");
            // 403 aqui normalmente é assinatura inválida (Content-Type diferente) ou CORS bloqueando preflight
            throw new Error(
              `Falha no upload direto (HTTP ${putRes.status})${errorText ? ` - ${errorText.slice(0, 180)}` : ""}`
            );
          }

          // preview (signed GET) com o fileKey
          const urlRes = await utils.upload.getFileUrl.fetch({ fileKey });

          result = {
            success: true,
            fileId,
            fileKey,
            url: (urlRes as any)?.url,
          };
        } catch (e) {
          // ✅ fallback seguro para imagens pequenas quando o PUT falhar (geralmente CORS)
          // (vídeo não tem fallback viável via base64)
          if (!isVideo && file.size <= 8 * 1024 * 1024) {
            result = await tryUploadBase64();
          } else {
            const msg = e instanceof Error ? e.message : "Falha no upload direto";
            throw new Error(
              isVideo
                ? `${msg}. Para vídeo via S3, habilite CORS (PUT/GET/HEAD) no bucket e permita header Content-Type.`
                : msg
            );
          }
        }
      } else {
        result = await tryUploadBase64();
      }

      const url =
        (result as any)?.url ??
        (result as any)?.publicUrl ??
        (result as any)?.public_url ??
        undefined;

      const fileKey =
        typeof (result as any)?.fileKey === "string"
          ? (result as any).fileKey
          : typeof (result as any)?.key === "string"
            ? (result as any).key
            : undefined;

      const fileId = normalizeFileId((result as any)?.fileId ?? (result as any)?.id);

      if ((result as any)?.success) {
        if (manageState) {
          setProgress({
            loaded: file.size,
            total: file.size,
            percentage: 100,
          });
        }

        if (showToast) toast.success("Arquivo enviado com sucesso");

        return {
          success: true,
          fileId,
          publicUrl: url,
          fileKey,
        };
      }

      const msg = (result as any)?.error ?? (result as any)?.message ?? "Erro no upload";
      throw new Error(String(msg));
    } catch (error) {
      console.error("Erro no upload:", error);

      const errorMessage = error instanceof Error ? error.message : "Erro ao enviar arquivo";
      if (showToast) toast.error(errorMessage);

      return { success: false, error: errorMessage };
    } finally {
      if (manageState) setUploading(false);
    }
  };

  const uploadFile = async (
    file: File,
    relatedNotificationId?: number,
    tenantId?: number
  ): Promise<UploadResult> => {
    return uploadFileInternal(file, relatedNotificationId, tenantId, {
      manageState: true,
      showToast: true,
    });
  };

  /**
   * ✅ Upload múltiplo com concorrência limitada
   * - evita 413 / estouro em functions / rajadas de requests
   * - mantém a ordem dos resultados
   */
  const uploadMultipleFiles = async (
    files: File[],
    relatedNotificationId?: number,
    tenantId?: number
  ): Promise<UploadResult[]> => {
    if (!files.length) return [];

    setUploading(true);

    const total = files.reduce((acc, f) => acc + (f?.size || 0), 0);
    let loaded = 0;
    const results: UploadResult[] = new Array(files.length);
    const concurrency = Math.min(2, files.length);

    setProgress({
      loaded: 0,
      total,
      percentage: total > 0 ? 5 : 0,
    });

    let nextIndex = 0;

    const runWorker = async () => {
      while (nextIndex < files.length) {
        const currentIndex = nextIndex++;
        const file = files[currentIndex];

        const res = await uploadFileInternal(file, relatedNotificationId, tenantId, {
          manageState: false,
          showToast: true,
        });

        results[currentIndex] = res;
        loaded += file.size;

        const pct = total > 0 ? Math.min(99, Math.round((loaded / total) * 100)) : 100;
        setProgress({ loaded, total, percentage: pct });
      }
    };

    await Promise.all(Array.from({ length: concurrency }, () => runWorker()));

    setProgress({ loaded: total, total, percentage: 100 });
    setUploading(false);

    return results;
  };

  return {
    uploadFile,
    uploadMultipleFiles,
    uploading,
    progress,
  };
}
