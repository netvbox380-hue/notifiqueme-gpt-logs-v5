import { trpc } from "@/lib/trpc";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Clock, Eye, EyeOff, XCircle } from "lucide-react";
import { format } from "date-fns";

interface DeliveryLogsProps {
  notificationId: number;
}

export function DeliveryLogs({ notificationId }: DeliveryLogsProps) {
  const { data: logs, isLoading } = trpc.notifications.getDeliveryLogs.useQuery({ notificationId });

  if (isLoading) return <div className="p-4 animate-pulse">Carregando logs de entrega...</div>;
  if (!logs || logs.length === 0) return <div className="p-4 text-muted-foreground">Nenhum log de entrega encontrado.</div>;

  return (
    <div className="border-2 border-border rounded-lg overflow-hidden">
      <Table>
        <TableHeader className="bg-secondary">
          <TableRow>
            <TableHead className="font-bold uppercase text-xs">Usuário</TableHead>
            <TableHead className="font-bold uppercase text-xs">Status</TableHead>
            <TableHead className="font-bold uppercase text-xs">Enviado em</TableHead>
            <TableHead className="font-bold uppercase text-xs">Lido em</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {logs.map((log) => (
            <TableRow key={log.id} className="hover:bg-secondary/50">
              <TableCell className="font-medium">{log.userName || "Usuário Desconhecido"}</TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  {log.status === "sent" && <Clock className="w-4 h-4 text-yellow-500" />}
                  {log.status === "delivered" && <CheckCircle2 className="w-4 h-4 text-green-500" />}
                  {log.status === "failed" && <XCircle className="w-4 h-4 text-destructive" />}
                  <span className="capitalize text-xs">{log.status}</span>
                </div>
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {log.deliveredAt ? format(new Date(log.deliveredAt), "dd/MM HH:mm") : "-"}
              </TableCell>
              <TableCell>
                {log.isRead ? (
                  <div className="flex items-center gap-2 text-green-600">
                    <Eye className="w-4 h-4" />
                    <span className="text-xs font-bold">{format(new Date(log.readAt!), "dd/MM HH:mm")}</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <EyeOff className="w-4 h-4" />
                    <span className="text-xs">Não lido</span>
                  </div>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
