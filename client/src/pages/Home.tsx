import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { getLoginUrl } from "@/const";
import { Streamdown } from 'streamdown';
import { useLocation } from "wouter";
import { useEffect } from "react";

/**
 * Home page - redireciona para dashboard ou login
 * Design: Brutalismo Digital
 */
export default function Home() {
  const { user, loading, isAuthenticated } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!loading) {
      if (isAuthenticated && user) {
        setLocation("/dashboard");
      } else {
        setLocation("/login");
      }
    }
  }, [isAuthenticated, user, loading, setLocation]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center">
        <div className="inline-block w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mb-4"></div>
        <p className="text-muted-foreground mono">CARREGANDO...</p>
      </div>
    </div>
  );
}
