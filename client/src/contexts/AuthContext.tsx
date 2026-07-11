// client/src/contexts/AuthContext.tsx
import React, { createContext, useCallback, useContext, useMemo } from "react";
import { trpc } from "@/lib/trpc";

export type UserRole = "user" | "admin" | "reseller" | "owner";

export interface UserData {
  id: number;
  openId: string;
  name: string | null;
  email: string | null;
  role: UserRole;
  tenantId: number | null;
}

interface AuthContextType {
  userData: UserData | null;
  loading: boolean;
  isAuthenticated: boolean;

  // flags
  isAdmin: boolean; // owner OU admin com tenant
  isOwner: boolean;
  isReseller: boolean;
  isUser: boolean;
  isTenantAdmin: boolean; // admin com tenant

  login: (params: {
    loginId: string;
    password: string;
    name?: string;
    email?: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function normalizeMe(data: unknown): UserData | null {
  if (!data || typeof data !== "object") return null;

  const anyData = data as any;

  // formato { user: ... }
  if ("user" in anyData) {
    const u = anyData.user;
    if (!u || typeof u !== "object") return null;
    if (!("role" in u) || !("openId" in u)) return null;
    return u as UserData;
  }

  // formato user direto
  if ("role" in anyData && "openId" in anyData) {
    return anyData as UserData;
  }

  return null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const utils = trpc.useUtils();

  const meQuery = trpc.auth.me.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
    onError: (err: any) => {
      // ✅ evita estado “fantasma” quando sessão expira
      // (instanceof pode falhar no bundle, então checamos o formato)
      if (err?.data?.code === "UNAUTHORIZED") {
        utils.auth.me.setData(undefined, undefined);
      }
    },
  });

  const loginMutation = trpc.auth.login.useMutation({
    onSuccess: async () => {
      await utils.auth.me.invalidate();
    },
  });

  const logoutMutation = trpc.auth.logout.useMutation();

  const login = useCallback(
    async ({
      loginId,
      password,
      name,
      email,
    }: {
      loginId: string;
      password: string;
      name?: string;
      email?: string;
    }) => {
      const openId = loginId.trim().toLowerCase();

      await loginMutation.mutateAsync({
        loginId: openId,
        password,
        name: name?.trim() || undefined,
        email: email?.trim().toLowerCase() || undefined,
      });

      // ✅ garante que o contexto pegue o usuário atual
      await utils.auth.me.refetch();
    },
    [loginMutation, utils.auth.me]
  );

  const logout = useCallback(async () => {
    // ✅ NÃO pode travar UX: “Sair” deve funcionar mesmo se a API falhar
    try {
      await logoutMutation.mutateAsync();
    } catch {
      // ignora (rede / já deslogado / cookie expirou)
    } finally {
      // ✅ limpa local SEM depender do servidor
      utils.auth.me.setData(undefined, undefined);

      try {
        await utils.auth.me.invalidate();
      } catch {
        // ok
      }
    }
  }, [logoutMutation, utils.auth.me]);

  const refresh = useCallback(async () => {
    await utils.auth.me.refetch();
  }, [utils.auth.me]);

  const userData = normalizeMe(meQuery.data);

  const value = useMemo<AuthContextType>(() => {
    const role = userData?.role;
    const tenantId = userData?.tenantId ?? null;

    const isOwner = role === "owner";
    const isReseller = role === "reseller";
    const isTenantAdmin = role === "admin" && !!tenantId;
    const isUser = !!userData && role === "user";

    return {
      userData,
      loading:
        meQuery.isLoading ||
        meQuery.isFetching ||
        loginMutation.isPending ||
        logoutMutation.isPending,
      isAuthenticated: Boolean(userData),

      isAdmin: isOwner || isReseller || isTenantAdmin,
      isOwner,
      isReseller,
      isTenantAdmin,
      isUser,

      login,
      logout,
      refresh,
    };
  }, [
    userData,
    meQuery.isLoading,
    meQuery.isFetching,
    loginMutation.isPending,
    logoutMutation.isPending,
    login,
    logout,
    refresh,
  ]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
