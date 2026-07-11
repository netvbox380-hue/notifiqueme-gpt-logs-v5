import { useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  clearDiagnosticLogs,
  DiagnosticEntry,
  downloadDiagnosticReport,
  readDiagnosticLogs,
  runSystemDiagnostics,
  subscribeDiagnosticLogs,
  SystemDiagnosticSnapshot,
  writeDiagnosticLog,
} from "@/lib/diagnostics";
import { Activity, Bug, Clipboard, Download, Play, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";

function formatDateTime(d?: string | Date | null) {
  if (!d) return "-";
  const dt = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(dt.getTime())) return "-";
  return dt.toLocaleString();
}

function statusLabel(value: boolean) {
  return value ? "OK" : "FALHA";
}

export default function Logs() {
  const [page, setPage] = useState(0);
  const [mode, setMode] = useState<"diagnostics" | "audit">("diagnostics");
  const [clientLogs, setClientLogs] = useState<DiagnosticEntry[]>(() => readDiagnosticLogs());
  const [snapshot, setSnapshot] = useState<SystemDiagnosticSnapshot | null>(null);
  const [running, setRunning] = useState(false);
  const [pushServerDiagnostics, setPushServerDiagnostics] = useState<any>(null);
  const [pushTestResult, setPushTestResult] = useState<any>(null);
  const [levelFilter, setLevelFilter] = useState<"all" | "error" | "warn" | "info">("all");
  const limit = 50;

  const input = useMemo(() => ({ limit, offset: page * limit }), [page]);
  const { data, isLoading, error, refetch } = trpc.tenant.listLogs.useQuery(input, {
    enabled: mode === "audit",
  });
  const pushDiagnosticsMutation = trpc.push.diagnostics.useMutation();
  const pushTestMutation = trpc.push.test.useMutation();

  useEffect(() => subscribeDiagnosticLogs(() => setClientLogs(readDiagnosticLogs())), []);

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const visibleLogs = clientLogs
    .filter((item) => levelFilter === "all" || item.level === levelFilter)
    .slice()
    .reverse();

  async function executeDiagnostics() {
    setRunning(true);
    try {
      const result = await runSystemDiagnostics();
      setSnapshot(result);

      let serverResult: any = null;
      try {
        serverResult = await pushDiagnosticsMutation.mutateAsync({
          endpoint: result.push.rawEndpoint || undefined,
        });
        setPushServerDiagnostics(serverResult);
        writeDiagnosticLog(
          serverResult.endpointMatched ? "info" : "warn",
          "push-server",
          serverResult.endpointMatched
            ? "Subscription local confirmada no backend"
            : "Subscription local não foi confirmada no backend",
          serverResult,
        );
      } catch (serverError) {
        setPushServerDiagnostics(null);
        writeDiagnosticLog("error", "push-server", "Falha ao consultar diagnóstico do backend", serverError);
      }

      setClientLogs(readDiagnosticLogs());
      if (
        result.network.healthz.ok &&
        result.push.subscriptions > 0 &&
        serverResult?.endpointMatched
      ) {
        toast.success("Diagnóstico push concluído: cliente e servidor sincronizados");
      } else {
        toast.warning("Diagnóstico concluído com pontos de atenção");
      }
    } catch (diagnosticError) {
      writeDiagnosticLog("error", "diagnostics-ui", "Falha ao executar diagnóstico", diagnosticError);
      toast.error("Falha ao executar diagnóstico");
    } finally {
      setRunning(false);
    }
  }

  async function executeRealPushTest() {
    setRunning(true);
    try {
      const result = await pushTestMutation.mutateAsync();
      setPushTestResult(result);
      writeDiagnosticLog(
        result.success ? "info" : "error",
        "push-test",
        result.success ? "Teste push enviado pelo backend" : "Teste push falhou no backend",
        result,
      );
      setClientLogs(readDiagnosticLogs());
      if (result.success) toast.success(`Push de teste enviado para ${result.sent}/${result.total} subscription(s)`);
      else toast.error(result.error || "Falha no teste de push");
    } catch (testError) {
      writeDiagnosticLog("error", "push-test", "Falha ao executar teste push", testError);
      setClientLogs(readDiagnosticLogs());
      toast.error("Falha ao executar teste push");
    } finally {
      setRunning(false);
    }
  }

  async function copyReport() {
    const safeSnapshot = snapshot
      ? { ...snapshot, push: { ...snapshot.push, rawEndpoint: snapshot.push.rawEndpoint ? "[REDACTED]" : null } }
      : null;
    const payload = JSON.stringify({
      snapshot: safeSnapshot,
      pushServerDiagnostics,
      pushTestResult,
      logs: readDiagnosticLogs(),
    }, null, 2);
    try {
      await navigator.clipboard.writeText(payload);
      toast.success("Relatório copiado");
    } catch {
      toast.error("Não foi possível copiar. Use Baixar relatório.");
    }
  }

  return (
    <DashboardLayout>
      <div className="p-4 md:p-8 space-y-6">
        <div>
          <h1 className="text-3xl md:text-4xl font-bold text-foreground mono mb-2">CENTRAL DE LOGS</h1>
          <div className="h-1 w-32 bg-primary" />
          <p className="text-muted-foreground mt-4">
            Diagnóstico do aplicativo, push, rede e auditoria do tenant. Dados sensíveis são ocultados automaticamente.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant={mode === "diagnostics" ? "default" : "outline"} onClick={() => setMode("diagnostics")}>
            <Bug className="w-4 h-4 mr-2" /> Diagnóstico técnico
          </Button>
          <Button variant={mode === "audit" ? "default" : "outline"} onClick={() => setMode("audit")}>
            <Activity className="w-4 h-4 mr-2" /> Auditoria do tenant
          </Button>
        </div>

        {mode === "diagnostics" ? (
          <>
            <div className="brutalist-card p-5 md:p-6 space-y-4">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div>
                  <h2 className="text-xl font-bold">Rastreamento do NotifiqueMe</h2>
                  <p className="text-sm text-muted-foreground">
                    Registra erros JavaScript, promessas, tRPC, HTTP, Service Worker, perda de rede e falhas React neste dispositivo.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={executeDiagnostics} disabled={running}>
                    <Play className="w-4 h-4 mr-2" /> {running ? "Executando..." : "Diagnosticar push"}
                  </Button>
                  <Button variant="secondary" onClick={executeRealPushTest} disabled={running}>
                    <Activity className="w-4 h-4 mr-2" /> Testar push real
                  </Button>
                  <Button variant="outline" onClick={copyReport}>
                    <Clipboard className="w-4 h-4 mr-2" /> Copiar
                  </Button>
                  <Button variant="outline" onClick={() => downloadDiagnosticReport(snapshot ?? undefined)}>
                    <Download className="w-4 h-4 mr-2" /> Baixar relatório
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => {
                      clearDiagnosticLogs();
                      setClientLogs([]);
                      setSnapshot(null);
                      setPushServerDiagnostics(null);
                      setPushTestResult(null);
                      toast.success("Logs locais apagados");
                    }}
                  >
                    <Trash2 className="w-4 h-4 mr-2" /> Limpar
                  </Button>
                </div>
              </div>

              {snapshot ? (
                <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <div className="border-2 border-border p-4">
                    <div className="text-xs text-muted-foreground">Servidor /healthz</div>
                    <div className="font-bold mt-1">{statusLabel(snapshot.network.healthz.ok)}</div>
                    <div className="text-xs text-muted-foreground">HTTP {snapshot.network.healthz.status ?? "-"} • {snapshot.network.healthz.elapsedMs ?? "-"}ms</div>
                  </div>
                  <div className="border-2 border-border p-4">
                    <div className="text-xs text-muted-foreground">Push</div>
                    <div className="font-bold mt-1">{snapshot.push.subscriptions > 0 ? "ATIVO" : "SEM SUBSCRIPTION"}</div>
                    <div className="text-xs text-muted-foreground">Permissão: {snapshot.push.permission}</div>
                  </div>
                  <div className="border-2 border-border p-4">
                    <div className="text-xs text-muted-foreground">Service Worker</div>
                    <div className="font-bold mt-1">{snapshot.push.activeWorkers} ativo(s)</div>
                    <div className="text-xs text-muted-foreground">{snapshot.push.registrations} registro(s) • controller {snapshot.push.controller ? "sim" : "não"}</div>
                  </div>
                  <div className="border-2 border-border p-4">
                    <div className="text-xs text-muted-foreground">Aplicativo</div>
                    <div className="font-bold mt-1">{snapshot.app.online ? "ONLINE" : "OFFLINE"}</div>
                    <div className="text-xs text-muted-foreground">PWA: {snapshot.app.standalone ? "instalado" : "navegador"}</div>
                  </div>
                </div>
              ) : (
                <div className="border-2 border-dashed border-border p-5 text-sm text-muted-foreground">
                  Clique em <strong>Executar diagnóstico</strong> após ativar as notificações, após recarregar e também quando ocorrer uma falha.
                </div>
              )}

              {snapshot ? (
                <div className="grid lg:grid-cols-2 gap-4">
                  <div className="border-2 border-border p-4 space-y-2">
                    <h3 className="font-bold">CLIENTE E SERVICE WORKER</h3>
                    <div className="text-sm grid grid-cols-2 gap-2">
                      <span>Permissão</span><strong>{snapshot.push.permission}</strong>
                      <span>Subscription local</span><strong>{snapshot.push.subscriptions > 0 ? "SIM" : "NÃO"}</strong>
                      <span>Worker ativo</span><strong>{snapshot.push.activeWorkers > 0 ? "SIM" : "NÃO"}</strong>
                      <span>Controller</span><strong>{snapshot.push.controller ? "SIM" : "NÃO"}</strong>
                      <span>Eventos persistidos</span><strong>{snapshot.push.serviceWorkerEvents.length}</strong>
                    </div>
                    {snapshot.push.serviceWorkerEvents.length ? (
                      <div className="max-h-48 overflow-auto border border-border p-2 text-xs space-y-1">
                        {snapshot.push.serviceWorkerEvents.slice().reverse().map((event, index) => (
                          <div key={`${event.at}-${index}`} className="flex gap-2">
                            <span className="text-muted-foreground whitespace-nowrap">{formatDateTime(event.at)}</span>
                            <strong>{event.type}</strong>
                          </div>
                        ))}
                      </div>
                    ) : <p className="text-xs text-muted-foreground">Nenhum evento persistido pelo Service Worker ainda.</p>}
                  </div>

                  <div className="border-2 border-border p-4 space-y-2">
                    <h3 className="font-bold">BACKEND E SUPABASE</h3>
                    {pushServerDiagnostics ? (
                      <div className="text-sm grid grid-cols-2 gap-2">
                        <span>Autenticado</span><strong>{pushServerDiagnostics.authenticated ? "SIM" : "NÃO"}</strong>
                        <span>VAPID configurado</span><strong>{pushServerDiagnostics.vapidConfigured ? "SIM" : "NÃO"}</strong>
                        <span>Subscriptions no banco</span><strong>{pushServerDiagnostics.subscriptionsInDatabase}</strong>
                        <span>Endpoint deste aparelho</span><strong>{pushServerDiagnostics.endpointMatched ? "CONFIRMADO" : "NÃO ENCONTRADO"}</strong>
                        <span>Tenant</span><strong>{pushServerDiagnostics.tenantId ?? "-"}</strong>
                        <span>Verificado em</span><strong>{formatDateTime(pushServerDiagnostics.checkedAt)}</strong>
                      </div>
                    ) : <p className="text-sm text-muted-foreground">Execute o diagnóstico para consultar o backend.</p>}
                    {pushTestResult ? (
                      <div className="border border-border p-3 text-sm">
                        <strong>Último teste:</strong> {pushTestResult.success ? "ENVIADO" : "FALHOU"}
                        <div className="text-xs text-muted-foreground mt-1">
                          enviados {pushTestResult.sent ?? 0} / {pushTestResult.total ?? 0} • expirados removidos {pushTestResult.expiredRemoved ?? 0}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="brutalist-card p-5 md:p-6">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                <div>
                  <h2 className="text-xl font-bold">Eventos capturados</h2>
                  <p className="text-sm text-muted-foreground">Últimos {clientLogs.length} eventos armazenados somente neste dispositivo.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {(["all", "error", "warn", "info"] as const).map((level) => (
                    <Button key={level} size="sm" variant={levelFilter === level ? "default" : "outline"} onClick={() => setLevelFilter(level)}>
                      {level === "all" ? "Todos" : level.toUpperCase()}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="space-y-2 max-h-[620px] overflow-auto">
                {visibleLogs.map((item) => (
                  <div key={item.id} className="border-2 border-border p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={item.level === "error" ? "destructive" : item.level === "warn" ? "secondary" : "outline"}>
                        {item.level.toUpperCase()}
                      </Badge>
                      <span className="font-semibold">{item.source}</span>
                      <span className="text-xs text-muted-foreground">{formatDateTime(item.at)}</span>
                      {item.path ? <span className="text-xs text-muted-foreground break-all">{item.path}</span> : null}
                    </div>
                    <div className="mt-2 break-words">{item.message}</div>
                    {item.details !== undefined ? (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-xs font-semibold text-muted-foreground">Detalhes técnicos</summary>
                        <pre className="mt-2 p-3 bg-muted overflow-auto text-xs whitespace-pre-wrap break-all">{JSON.stringify(item.details, null, 2)}</pre>
                      </details>
                    ) : null}
                  </div>
                ))}
                {visibleLogs.length === 0 ? <p className="text-muted-foreground text-center py-8">Nenhum evento neste filtro.</p> : null}
              </div>
            </div>
          </>
        ) : (
          <div className="brutalist-card p-6">
            <div className="flex items-center justify-between gap-3 mb-4">
              <div className="text-sm text-muted-foreground">
                {isLoading ? "Carregando…" : `Total: ${total}`}
                {error ? " • Erro ao carregar" : ""}
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => void refetch()}><RefreshCw className="w-4 h-4" /></Button>
                <Button variant="secondary" disabled={page <= 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>Anterior</Button>
                <div className="text-xs text-muted-foreground">Página {page + 1} / {totalPages}</div>
                <Button variant="secondary" disabled={page + 1 >= totalPages} onClick={() => setPage((p) => p + 1)}>Próxima</Button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left border-b border-border"><th className="py-2 pr-3">Quando</th><th className="py-2 pr-3">Ação</th><th className="py-2 pr-3">Entidade</th><th className="py-2 pr-3">IDs</th><th className="py-2">Detalhes</th></tr></thead>
                <tbody>
                  {(data?.data ?? []).map((l: any) => (
                    <tr key={l.id} className="border-b border-border/50 align-top">
                      <td className="py-2 pr-3 whitespace-nowrap text-muted-foreground">{formatDateTime(l.createdAt)}</td>
                      <td className="py-2 pr-3 font-semibold">{l.action}</td>
                      <td className="py-2 pr-3 text-muted-foreground">{l.entityType ?? "-"}</td>
                      <td className="py-2 pr-3 text-muted-foreground whitespace-nowrap"><div>log#{l.id}</div>{l.entityId ? <div>ent#{l.entityId}</div> : null}{l.userId ? <div>user#{l.userId}</div> : null}{l.createdByAdminId ? <div>admin#{l.createdByAdminId}</div> : null}</td>
                      <td className="py-2 text-muted-foreground"><div className="line-clamp-3">{l.details ?? "-"}</div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!isLoading && (data?.data?.length ?? 0) === 0 ? <p className="text-muted-foreground text-center py-8">Nenhum log ainda.</p> : null}
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
