import React, { useRef, useState } from "react";
import { Upload, X, Image as ImageIcon, Video, FileIcon } from "lucide-react";
import { Button } from "./ui/button";
import { Progress } from "./ui/progress";
import { useFileUpload } from "../hooks/useFileUpload";
import { cn } from "../lib/utils";

interface FileUploaderProps {
  /**
   * ✅ Agora retorna também fileKey:
   * - publicUrl: preview imediato (pode expirar se for signed)
   * - fileKey: chave permanente (uploads/...) para salvar no DB
   */
  onUploadComplete?: (fileId: number, publicUrl: string, fileKey?: string) => void;

  relatedNotificationId?: number;
  tenantId?: number;
  accept?: string;
  maxFiles?: number;
  className?: string;
  autoUpload?: boolean;
}

export function FileUploader({
  onUploadComplete,
  relatedNotificationId,
  tenantId,
  accept = "image/*,video/*",
  maxFiles = 10,
  className,
  autoUpload = true,
}: FileUploaderProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  const { uploadMultipleFiles, uploading, progress } = useFileUpload();

  const resetSelection = () => {
    setSelectedFiles([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const uploadFiles = async (files: File[]) => {
    const results = await uploadMultipleFiles(files, relatedNotificationId, tenantId);

    for (const result of results) {
      // ✅ result esperado:
      // { success, fileId, publicUrl, fileKey? }
      if (result.success && result.fileId && result.publicUrl) {
        const fileIdNum = Number(result.fileId);
        const publicUrl = String(result.publicUrl);

        const fileKey =
          (result as any).fileKey && typeof (result as any).fileKey === "string"
            ? (result as any).fileKey
            : undefined;

        onUploadComplete?.(fileIdNum, publicUrl, fileKey);
      }
    }

    resetSelection();
  };

  const addFiles = async (files: File[]) => {
    if (!files.length) return;

    if (files.length + selectedFiles.length > maxFiles) {
      alert(`Você pode selecionar no máximo ${maxFiles} arquivo(s).`);
      return;
    }

    const next = [...selectedFiles, ...files];
    setSelectedFiles(next);

    if (autoUpload) {
      await uploadFiles(files);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    await addFiles(files);
  };

  const handleRemoveFile = (index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleUpload = async () => {
    await uploadFiles(selectedFiles);
  };

  const getFileIcon = (file: File) => {
    if (file.type.startsWith("image/")) {
      return <ImageIcon className="w-8 h-8 text-blue-500" />;
    }
    if (file.type.startsWith("video/")) {
      return <Video className="w-8 h-8 text-purple-500" />;
    }
    return <FileIcon className="w-8 h-8 text-gray-500" />;
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  return (
    <div className={cn("space-y-3", className)}>
      {/* Área de upload otimizada */}
      <div
        className={cn(
          "border-2 border-dashed rounded-xl text-center transition select-none",
          "p-4 sm:p-6 flex flex-col items-center justify-center",
          uploading ? "opacity-60 pointer-events-none" : "cursor-pointer",
          isDragging ? "border-primary bg-muted/50" : "border-gray-300 hover:border-gray-400"
        )}
        onClick={() => {
          if (!uploading) fileInputRef.current?.click();
        }}
        onDragEnter={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsDragging(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsDragging(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsDragging(false);
        }}
        onDrop={async (e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsDragging(false);

          if (uploading) return;

          const files = Array.from(e.dataTransfer.files || []);
          await addFiles(files);
        }}
      >
        <Upload className="w-10 h-10 mb-2 text-gray-400" />

        <p className="text-sm text-muted-foreground">Clique ou arraste arquivos aqui</p>

        <p className="text-xs text-muted-foreground mt-1">Imagens, vídeos e áudios até o limite do seu plano</p>

        <input
          ref={fileInputRef}
          type="file"
          accept={accept}
          multiple={maxFiles > 1}
          className="hidden"
          onChange={handleFileSelect}
          disabled={uploading}
        />
      </div>

      {/* Lista */}
      {selectedFiles.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">Arquivos selecionados</h3>

          <div className="space-y-2">
            {selectedFiles.map((file, index) => (
              <div
                key={`${file.name}-${file.size}-${index}`}
                className="flex items-center gap-3 p-3 bg-muted rounded-lg"
              >
                {getFileIcon(file)}

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{file.name}</p>
                  <p className="text-xs text-muted-foreground">{formatFileSize(file.size)}</p>
                </div>

                {!uploading && (
                  <button
                    type="button"
                    onClick={() => handleRemoveFile(index)}
                    className="p-1 hover:bg-background rounded"
                    aria-label="Remover arquivo"
                  >
                    <X className="w-4 h-4 text-muted-foreground" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Progresso */}
      {uploading && (
        <div className="space-y-2">
          <div className="flex justify-between text-xs">
            <span>Enviando...</span>
            <span>{progress.percentage}%</span>
          </div>
          <Progress value={progress.percentage} />
        </div>
      )}

      {/* Upload manual */}
      {selectedFiles.length > 0 && !uploading && !autoUpload && (
        <Button type="button" onClick={handleUpload} className="w-full">
          Enviar {selectedFiles.length} arquivo{selectedFiles.length > 1 ? "s" : ""}
        </Button>
      )}
    </div>
  );
}
