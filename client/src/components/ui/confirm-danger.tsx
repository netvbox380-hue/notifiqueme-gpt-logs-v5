import * as React from "react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "./alert-dialog";
import { Button } from "./button";

/**
 * ConfirmDanger
 * Modern, reusable confirmation for destructive actions.
 * - Optional "type to confirm" guard
 * - Standard loading state
 */
export function ConfirmDanger({
  trigger,
  title,
  description,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  requireText,
  requireTextLabel,
  onConfirm,
  confirming,
  disabled,
}: {
  trigger: React.ReactNode;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  requireText?: string; // e.g. "APAGAR"
  requireTextLabel?: string; // e.g. "Digite APAGAR para confirmar"
  onConfirm: () => void | Promise<void>;
  confirming?: boolean;
  disabled?: boolean;
}) {
  const [typed, setTyped] = React.useState("");

  const canConfirm = !disabled && !confirming && (!requireText || typed.trim().toUpperCase() === requireText.toUpperCase());

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{trigger as any}</AlertDialogTrigger>
      <AlertDialogContent className="max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description ? <AlertDialogDescription>{description}</AlertDialogDescription> : null}
        </AlertDialogHeader>

        {requireText ? (
          <div className="mt-2 space-y-2">
            <div className="text-sm text-muted-foreground">
              {requireTextLabel ?? `Digite ${requireText} para confirmar.`}
            </div>
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              placeholder={requireText}
              autoComplete="off"
            />
          </div>
        ) : null}

        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button type="button" variant="outline" disabled={confirming}>
              {cancelLabel}
            </Button>
          </AlertDialogCancel>
          <AlertDialogAction asChild>
            <Button
              type="button"
              variant="destructive"
              disabled={!canConfirm}
              onClick={(e) => {
                e.preventDefault();
                if (!canConfirm) return;
                void onConfirm();
              }}
            >
              {confirming ? "Aguarde..." : confirmLabel}
            </Button>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
