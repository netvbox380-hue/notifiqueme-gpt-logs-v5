import { useMemo, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";

function formatDateTime(d?: string | Date | null) {
  if (!d) return "-";
  const dt = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(dt.getTime())) return "-";
  return dt.toLocaleString();
}

export default function History() {
  const [page, setPage] = useState(0);
  const limit = 20;

  const input = useMemo(() => ({ limit, offset: page * limit }), [page]);
  const { data, isLoading, error } = trpc.notifications.list.useQuery(input);

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <DashboardLayout>
      <div className="p-8">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-foreground mono mb-2">HISTÓRICO</h1>
          <div className="h-1 w-32 bg-primary"></div>
          <p className="text-muted-foreground mt-4">
            Últimas notificações enviadas (por tenant).
          </p>
        </div>

        <div className="brutalist-card p-6">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div className="text-sm text-muted-foreground">
              {isLoading ? "Carregando…" : `Total: ${total}`}
              {error ? " • Erro ao carregar" : ""}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                disabled={page <= 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                Anterior
              </Button>
              <div className="text-xs text-muted-foreground">
                Página {page + 1} / {totalPages}
              </div>
              <Button
                variant="secondary"
                disabled={page + 1 >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Próxima
              </Button>
            </div>
          </div>

          <div className="space-y-3">
            {(data?.data ?? []).map((n: any) => (
              <div key={n.id} className="border border-border bg-background/40 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-bold">{n.title}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {formatDateTime(n.createdAt)}
                      {n.isScheduled ? " • Agendada" : ""}
                      {n.priority ? ` • ${String(n.priority).toUpperCase()}` : ""}
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">#{n.id}</div>
                </div>
                {n.content ? (
                  <div className="text-sm text-muted-foreground mt-3 line-clamp-3">
                    {n.content}
                  </div>
                ) : null}
              </div>
            ))}

            {!isLoading && (data?.data?.length ?? 0) === 0 && (
              <p className="text-muted-foreground text-center py-8">Nenhuma notificação ainda.</p>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
