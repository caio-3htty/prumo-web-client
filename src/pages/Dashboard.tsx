import { useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  BellRing,
  ChevronLeft,
  ClipboardList,
  Layers3,
  LineChart,
  LogOut,
  PackageSearch,
  RefreshCw,
  Shuffle,
  Truck,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import logoPrumo from "@/assets/image.png";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/i18n/useI18n";
import { canManageCadastros, roleLabelMap } from "@/lib/rbac";

type DashboardPayload = {
  master_gestor?: Record<string, number>;
  engenheiro?: Record<string, number>;
  operacional_almoxarife?: Record<string, number>;
  series?: {
    pedidos_por_status?: Array<{ status: string; total: number }>;
    materiais_risco?: Array<{ material_nome: string; dias_cobertura: number | null; risco: string; recomendacao: string }>;
  };
};

const Dashboard = () => {
  const { obraId } = useParams();
  const navigate = useNavigate();
  const { role, obras, signOut, tenantId } = useAuth();
  const { t } = useI18n();

  const obra = obras.find((item) => item.id === obraId);

  const quickActions = useMemo(() => {
    const base = [
      { label: t("orders"), icon: ClipboardList, path: `/dashboard/${obraId}/pedidos` },
      { label: t("receipt"), icon: Truck, path: `/dashboard/${obraId}/recebimento` },
      { label: t("stock"), icon: PackageSearch, path: `/dashboard/${obraId}/estoque` },
      { label: "Alertas", icon: BellRing, path: `/dashboard/${obraId}/alertas` },
      { label: "Substituicoes", icon: Shuffle, path: `/dashboard/${obraId}/substituicoes` },
      { label: "Relatorios", icon: LineChart, path: `/dashboard/${obraId}/relatorios` },
    ];

    if (role === "master" || role === "gestor" || role === "almoxarife") {
      base.push({
        label: "Modo Almoxarife",
        icon: RefreshCw,
        path: `/dashboard/${obraId}/almoxarife`,
      });
    }

    if (canManageCadastros(role)) {
      base.push({
        label: t("registries"),
        icon: Layers3,
        path: "/cadastros/fornecedores",
      });
    }

    if (role === "master" || role === "gestor") {
      base.push({
        label: "Importacao em lote",
        icon: PackageSearch,
        path: "/importacao-lote",
      });
    }

    return base;
  }, [obraId, role, t]);

  const { data: metrics } = useQuery({
    queryKey: ["dashboard-metrics", tenantId, obraId],
    enabled: !!tenantId,
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const supabaseAny = supabase as any;
      const { data, error } = await supabaseAny.rpc("get_dashboard_metrics", {
        _tenant_id: tenantId,
        _obra_id: obraId,
      });
      if (error) throw error;
      return (data ?? {}) as DashboardPayload;
    },
  });

  const activeKpis = useMemo(() => {
    if (role === "master" || role === "gestor") {
      return metrics?.master_gestor ?? {};
    }
    if (role === "engenheiro") {
      return metrics?.engenheiro ?? {};
    }
    return metrics?.operacional_almoxarife ?? {};
  }, [metrics, role]);

  const chartData = metrics?.series?.pedidos_por_status ?? [];
  const riscoTop = (metrics?.series?.materiais_risco ?? []).slice(0, 8);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 md:px-8">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/obras")} className="mr-1">
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <img src={logoPrumo} alt="Prumo" className="h-8 object-contain" />
            <div>
              <h1 className="text-lg font-bold leading-tight">{obra?.name ?? t("dashboardFallbackTitle")}</h1>
              {role && (
                <Badge variant="secondary" className="text-xs">
                  {roleLabelMap[role]}
                </Badge>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <LanguageSwitcher />
            <Button variant="ghost" size="sm" onClick={signOut}>
              <LogOut className="mr-1 h-4 w-4" /> {t("logout")}
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 md:px-8">
        <div className="animate-fade-in">
          <h2 className="mb-1 text-xl font-semibold">{t("dashboardOverviewTitle")}</h2>
          <p className="mb-6 text-muted-foreground">{obra?.address ?? t("dashboardOverviewSubtitle")}</p>

          <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {Object.entries(activeKpis).slice(0, 8).map(([key, value]) => (
              <div key={key} className="rounded-lg border border-border p-4">
                <p className="text-xs uppercase text-muted-foreground">{key.replaceAll("_", " ")}</p>
                <p className="mt-1 text-2xl font-semibold">{Number(value ?? 0)}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {quickActions.map((action, i) => (
              <Card
                key={action.label}
                className="cursor-pointer border-border/50 transition-all hover:border-primary/30 hover:shadow-md"
                style={{ animationDelay: `${i * 80}ms` }}
                onClick={() => navigate(action.path)}
              >
                <CardContent className="flex items-center gap-3 p-5">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                    <action.icon className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <p className="text-base font-medium">{action.label}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-lg border border-border p-4">
              <p className="mb-3 text-sm font-semibold">Pedidos por status (periodo)</p>
              {chartData.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sem dados para o periodo selecionado.</p>
              ) : (
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="status" />
                      <YAxis />
                      <Tooltip />
                      <Bar dataKey="total" fill="#3b6cae" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            <div className="rounded-lg border border-border p-4">
              <p className="mb-3 text-sm font-semibold">Materiais em risco / recomendacao</p>
              {riscoTop.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sem itens em monitoramento para esta obra.</p>
              ) : (
                <div className="space-y-2">
                  {riscoTop.map((item) => (
                    <div key={`${item.material_nome}-${item.risco}`} className="rounded-md border border-border px-3 py-2 text-sm">
                      <p className="font-medium">{item.material_nome}</p>
                      <p className="text-muted-foreground">
                        Risco: {item.risco} | Cobertura: {item.dias_cobertura ?? "n/a"} dias
                      </p>
                      <p>{item.recomendacao}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default Dashboard;
