import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";

const SessionUnlock = () => {
  const navigate = useNavigate();
  const {
    user,
    loading,
    sessionLocked,
    quickUnlockSetupRequired,
    setupQuickUnlockPin,
    unlockSessionWithPin,
    signOut,
    disableQuickUnlock,
  } = useAuth();
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && user && !sessionLocked && !quickUnlockSetupRequired) {
      navigate("/", { replace: true });
    }
  }, [loading, navigate, quickUnlockSetupRequired, sessionLocked, user]);

  if (loading) {
    return null;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  const setupMode = quickUnlockSetupRequired;

  const handleSubmit = async () => {
    setBusy(true);
    try {
      if (setupMode) {
        if (!/^\d{4,8}$/.test(pin)) {
          toast.error("PIN invalido", { description: "Use de 4 a 8 digitos numericos." });
          return;
        }
        if (pin !== confirmPin) {
          toast.error("PIN nao confere", { description: "Digite o mesmo PIN nos dois campos." });
          return;
        }
        const ok = await setupQuickUnlockPin(pin);
        if (!ok) {
          toast.error("Falha ao ativar desbloqueio rapido");
          return;
        }
        toast.success("Desbloqueio rapido ativado");
      } else {
        const ok = await unlockSessionWithPin(pin);
        if (!ok) {
          toast.error("PIN incorreto");
          return;
        }
      }
      navigate("/", { replace: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{setupMode ? "Configurar desbloqueio rapido" : "Desbloquear sessao"}</CardTitle>
          <CardDescription>
            {setupMode
              ? "Crie um PIN simples para entrar sem senha nas proximas aberturas."
              : "Digite seu PIN para continuar."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="pin">PIN</Label>
            <Input
              id="pin"
              type="password"
              inputMode="numeric"
              value={pin}
              onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))}
              placeholder="4 a 8 digitos"
              maxLength={8}
            />
          </div>

          {setupMode && (
            <div className="space-y-2">
              <Label htmlFor="confirmPin">Confirmar PIN</Label>
              <Input
                id="confirmPin"
                type="password"
                inputMode="numeric"
                value={confirmPin}
                onChange={(event) => setConfirmPin(event.target.value.replace(/\D/g, ""))}
                placeholder="Repita o PIN"
                maxLength={8}
              />
            </div>
          )}

          <Button className="w-full" onClick={handleSubmit} disabled={busy}>
            {setupMode ? "Salvar PIN" : "Entrar com PIN"}
          </Button>

          <div className="grid grid-cols-1 gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={async () => {
                await signOut();
                navigate("/login", { replace: true });
              }}
            >
              Trocar conta
            </Button>
            {setupMode && (
              <Button
                type="button"
                variant="ghost"
                onClick={async () => {
                  await disableQuickUnlock();
                  navigate("/", { replace: true });
                }}
              >
                Continuar sem desbloqueio rapido
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default SessionUnlock;

