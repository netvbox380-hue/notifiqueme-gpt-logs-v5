import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { trpc } from "@/lib/trpc";
import { KeyRound, User as UserIcon } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";

function normalizeErrorMessage(err: unknown) {
  const anyErr = err as any;

  // TRPCClientError costuma ter shape variável
  const msg =
    anyErr?.message ||
    anyErr?.data?.message ||
    anyErr?.shape?.message ||
    anyErr?.error?.message ||
    "";

  if (typeof msg === "string" && msg.trim()) return msg;

  return "Erro ao entrar";
}

export default function Login() {
  const { login, loading, userData, isAuthenticated } = useAuth();
  const [, setLocation] = useLocation();
  const inboxCountQuery = trpc.notifications.inboxCount.useQuery(undefined, {
    enabled: isAuthenticated && !!userData && userData.role === "admin",
    refetchOnWindowFocus: false,
    retry: false,
  });


  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");

  const finalLoginId = useMemo(() => loginId.trim().toLowerCase(), [loginId]);

  useEffect(() => {
    if (!isAuthenticated || !userData) return;

    if (userData.role === "user") {
      setLocation("/my-notifications");
      return;
    }

    if (userData.role === "owner" || userData.role === "reseller") {
      setLocation("/superadmin");
      return;
    }

    if (userData.role === "admin") {
      // ✅ se houver não lidas, leva direto pra área do usuário (inbox)
      if (inboxCountQuery.isLoading) return;
      const count = Number((inboxCountQuery.data as any)?.count ?? 0);
      if (count > 0) setLocation("/my-notifications");
      else setLocation("/dashboard");
      return;
    }
  }, [isAuthenticated, userData, setLocation, inboxCountQuery.isLoading, inboxCountQuery.data]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();

    if (!finalLoginId) {
      toast.error("Informe seu usuário");
      return;
    }
    if (!password.trim()) {
      toast.error("Informe sua senha");
      return;
    }

    try {
      await login({
        loginId: finalLoginId,
        password,
        name: name.trim() || undefined,
      });
      toast.success("Login realizado");
    } catch (err) {
      toast.error(normalizeErrorMessage(err));
      setPassword(""); // limpa senha após erro
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-background">
      <div className="w-full max-w-md border border-border rounded-2xl p-6 sm:p-8 bg-card shadow-sm">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold">Entrar</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Use seu usuário e senha (podem conter letras, números e &apos;;&apos;).
            Nome é opcional.
          </p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="loginId" className="flex items-center gap-2">
              <UserIcon className="w-4 h-4" /> Usuário ou e-mail
            </Label>
            <Input
              id="loginId"
              type="text"
              placeholder="Digite seu usuário ou e-mail"
              value={loginId}
              onChange={(e) => setLoginId(e.target.value)}
              autoComplete="username"
              disabled={loading}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password" className="flex items-center gap-2">
              <KeyRound className="w-4 h-4" /> Senha
            </Label>
            <Input
              id="password"
              type="password"
              placeholder="••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              disabled={loading}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="name" className="flex items-center gap-2">
              <UserIcon className="w-4 h-4" /> Nome (opcional)
            </Label>
            <Input
              id="name"
              type="text"
              placeholder="Seu nome"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              disabled={loading}
            />
          </div>

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Entrando..." : "Entrar"}
          </Button>
        </form>
      </div>
    </div>
  );
}
