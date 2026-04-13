import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { toast } from "sonner";

import { EstoqueSection } from "@/components/EstoqueSection";
import { PageShell } from "@/components/PageShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";

type EstoqueAjusteTipo = "inicial" | "correcao" | "inventario" | "recebimento_manual";

type MaterialOption = {
  id: string;
  nome: string;
  unidade: string;
};

type EstoqueItemLite = {
  material_id: string;
  estoque_atual: number;
  atualizado_por: string | null;
  ultima_atualizacao_estoque: string | null;
  materiais?: {
    nome: string;
    unidade: string;
    estoque_minimo: number;
    estoque_seguranca: number;
  } | null;
};

type AjusteRow = {
  id: string;
  material_id: string;
  tipo: EstoqueAjusteTipo;
  motivo: string | null;
  quantidade_anterior: number;
  delta: number;
  quantidade_resultante: number;
  registrado_por: string | null;
  created_at: string;
};

type ForecastRow = {
  material_id: string;
  material_nome: string;
  unidade: string;
  estoque_atual: number;
  consumo_medio_diario: number;
  dias_cobertura: number | null;
  lead_time_real_dias: number;
  risco: "alto" | "medio" | "baixo";
  recomendacao: string;
  justificativa: string;
  data_pedido_ideal: string | null;
  data_ruptura_estimada: string | null;
};

const ajusteTypeLabels: Record<EstoqueAjusteTipo, string> = {
  inicial: "Estoque inicial",
  correcao: "Correcao",
  inventario: "Inventario",
  recebimento_manual: "Recebimento manual",
};

const EstoqueManager = () => {
  const queryClient = useQueryClient();
  const { obraId } = useParams();
  const { tenantId } = useAuth();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabaseAny = supabase as any;

  const [selectedMaterialId, setSelectedMaterialId] = useState<string>("");
  const [tipoAjuste, setTipoAjuste] = useState<EstoqueAjusteTipo>("correcao");
  const [novoSaldo, setNovoSaldo] = useState<string>("0");
  const [motivo, setMotivo] = useState("");
  const [estoqueRows, setEstoqueRows] = useState<EstoqueItemLite[]>([]);

  const { data: materiais = [] } = useQuery({
    queryKey: ["estoque-material-options"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("materiais")
        .select("id, nome, unidade")
        .is("deleted_at", null)
        .order("nome");
      if (error) throw error;
      return (data ?? []) as MaterialOption[];
    },
  });

  const { data: ajustes = [] } = useQuery({
    queryKey: ["estoque-ajustes", obraId],
    queryFn: async () => {
      if (!obraId) return [] as AjusteRow[];
      const { data, error } = await supabaseAny
        .from("estoque_ajustes")
        .select("id, material_id, tipo, motivo, quantidade_anterior, delta, quantidade_resultante, registrado_por, created_at")
        .eq("obra_id", obraId)
        .order("created_at", { ascending: false })
        .limit(120);
      if (error) throw error;
      return (data ?? []) as AjusteRow[];
    },
    enabled: !!obraId,
  });

  const { data: forecastRows = [], refetch: refetchForecast } = useQuery({
    queryKey: ["estoque-forecast", tenantId, obraId],
    enabled: !!tenantId && !!obraId,
    queryFn: async () => {
      const { data, error } = await supabaseAny.rpc("compute_material_forecast", {
        _tenant_id: tenantId,
        _obra_id: obraId,
      });
      if (error) throw error;
      return (data ?? []) as ForecastRow[];
    },
  });

  const snapshotForecast = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabaseAny.rpc("registrar_snapshot_recomendacoes", {
        _tenant_id: tenantId,
        _obra_id: obraId,
      });
      if (error) throw error;
      return data as { inserted?: number };
    },
    onSuccess: (payload) => {
      toast.success("Snapshot de recomendacoes registrado.", {
        description: `${payload?.inserted ?? 0} registros salvos no historico.`,
      });
      refetchForecast();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const userIdsFromAjustes = useMemo(
    () => {
      const ajusteUsers = ajustes.map((item) => item.registrado_por).filter(Boolean) as string[];
      const estoqueUsers = estoqueRows.map((item) => item.atualizado_por).filter(Boolean) as string[];
      return Array.from(new Set([...ajusteUsers, ...estoqueUsers]));
    },
    [ajustes, estoqueRows],
  );

  const { data: profileNames = [] } = useQuery({
    queryKey: ["estoque-ajustes-users", userIdsFromAjustes],
    queryFn: async () => {
      if (userIdsFromAjustes.length === 0) return [] as Array<{ user_id: string; full_name: string | null; email: string | null }>;
      const { data, error } = await supabase
        .from("profiles")
        .select("user_id, full_name, email")
        .in("user_id", userIdsFromAjustes);
      if (error) throw error;
      return (data ?? []) as Array<{ user_id: string; full_name: string | null; email: string | null }>;
    },
    enabled: userIdsFromAjustes.length > 0,
  });

  const profileByUserId = useMemo(
    () =>
      profileNames.reduce<Record<string, string>>((acc, row) => {
        acc[row.user_id] = row.full_name || row.email || row.user_id;
        return acc;
      }, {}),
    [profileNames],
  );

  const materialById = useMemo(
    () =>
      materiais.reduce<Record<string, MaterialOption>>((acc, material) => {
        acc[material.id] = material;
        return acc;
      }, {}),
    [materiais],
  );

  const saldoAtualSelecionado = useMemo(() => {
    const match = estoqueRows.find((item) => item.material_id === selectedMaterialId);
    return match?.estoque_atual ?? 0;
  }, [estoqueRows, selectedMaterialId]);

  const alertasOperacionais = useMemo(() => {
    const now = Date.now();
    return estoqueRows.flatMap((item) => {
      const nomeMaterial = item.materiais?.nome ?? item.material_id;
      const limiteCobertura = (item.materiais?.estoque_minimo ?? 0) + (item.materiais?.estoque_seguranca ?? 0);
      const updatedAt = item.ultima_atualizacao_estoque
        ? new Date(item.ultima_atualizacao_estoque).getTime()
        : Number.NaN;
      const outdated = Number.isFinite(updatedAt) ? (now - updatedAt) / (1000 * 60 * 60) >= 24 : true;
      const updatedByName = item.atualizado_por ? (profileByUserId[item.atualizado_por] ?? item.atualizado_por) : "nao identificado";

      if (item.estoque_atual <= 0) {
        return [
          {
            key: `${item.material_id}-zerado`,
            tone: "border-red-300 bg-red-50 text-red-900",
            title: `${nomeMaterial}: estoque zerado real`,
            detail: "Registre reposicao ou ajuste de recebimento imediatamente.",
          },
        ];
      }

      const alerts: Array<{ key: string; tone: string; title: string; detail: string }> = [];
      if (outdated) {
        alerts.push({
          key: `${item.material_id}-outdated`,
          tone: "border-amber-300 bg-amber-50 text-amber-900",
          title: `${nomeMaterial}: estoque desatualizado`,
          detail: `Ultima atualizacao sem refresh recente. Atualizado por ${updatedByName}.`,
        });
      }
      if (item.estoque_atual <= limiteCobertura) {
        alerts.push({
          key: `${item.material_id}-coverage`,
          tone: "border-orange-300 bg-orange-50 text-orange-900",
          title: `${nomeMaterial}: cobertura insuficiente`,
          detail: `Saldo (${item.estoque_atual}) abaixo do limite operacional (${limiteCobertura}). Avalie compra/reposicao.`,
        });
      }
      return alerts;
    });
  }, [estoqueRows, profileByUserId]);

  const resumoForecast = useMemo(() => {
    const alto = forecastRows.filter((item) => item.risco === "alto").length;
    const medio = forecastRows.filter((item) => item.risco === "medio").length;
    const baixo = forecastRows.filter((item) => item.risco === "baixo").length;
    return { alto, medio, baixo, total: forecastRows.length };
  }, [forecastRows]);

  const registrarAjuste = useMutation({
    mutationFn: async () => {
      if (!obraId) {
        throw new Error("Obra nao identificada para ajuste de estoque.");
      }
      if (!selectedMaterialId) {
        throw new Error("Selecione o material para ajustar.");
      }
      const saldo = Number(novoSaldo);
      if (Number.isNaN(saldo)) {
        throw new Error("Informe um valor numerico de saldo.");
      }

      const { data, error } = await supabaseAny.rpc("registrar_ajuste_estoque", {
        _obra_id: obraId,
        _material_id: selectedMaterialId,
        _tipo: tipoAjuste,
        _novo_saldo: saldo,
        _motivo: motivo.trim() || null,
      });

      if (error) throw error;
      return data as { ok?: boolean };
    },
    onSuccess: async () => {
      toast.success("Ajuste de estoque registrado.");
      setNovoSaldo("0");
      setMotivo("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["estoque_obra_material", obraId] }),
        queryClient.invalidateQueries({ queryKey: ["estoque-ajustes", obraId] }),
      ]);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <PageShell title="Estoque">
      <h2 className="text-xl font-semibold">Estoque da Obra</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Visualizacao consolidada de materiais, confiabilidade e historico de ajustes.
      </p>

      {tenantId && obraId ? (
        <div className="mt-4 rounded-lg border border-border p-4">
          <h3 className="text-base font-semibold">Ajuste manual de estoque</h3>
          <p className="mb-4 mt-1 text-xs text-muted-foreground">
            Tipos disponiveis: inicial, correcao, inventario e recebimento manual.
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Material</Label>
              <Select value={selectedMaterialId} onValueChange={setSelectedMaterialId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o material" />
                </SelectTrigger>
                <SelectContent>
                  {materiais.map((material) => (
                    <SelectItem key={material.id} value={material.id}>
                      {material.nome} ({material.unidade})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Tipo de ajuste</Label>
              <Select value={tipoAjuste} onValueChange={(value) => setTipoAjuste(value as EstoqueAjusteTipo)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(ajusteTypeLabels).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Saldo atual</Label>
              <Input value={String(saldoAtualSelecionado)} readOnly />
            </div>
            <div className="space-y-2">
              <Label>Novo saldo</Label>
              <Input
                type="number"
                step="0.01"
                value={novoSaldo}
                onChange={(event) => setNovoSaldo(event.target.value)}
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>Motivo</Label>
              <Input
                value={motivo}
                onChange={(event) => setMotivo(event.target.value)}
                placeholder="Ex.: inventario da semana, ajuste de saldo inicial..."
              />
            </div>
          </div>
          <div className="mt-3 flex justify-end">
            <Button onClick={() => registrarAjuste.mutate()} disabled={registrarAjuste.isPending}>
              Registrar ajuste
            </Button>
          </div>
        </div>
      ) : (
        <p className="mt-4 text-sm text-amber-700">
          A rota de estoque exige obra selecionada para ajuste manual.
        </p>
      )}

      {alertasOperacionais.length > 0 && (
        <div className="mt-4 space-y-2">
          <h3 className="text-base font-semibold">Alertas operacionais (24h/cobertura)</h3>
          {alertasOperacionais.map((alerta) => (
            <div key={alerta.key} className={`rounded-md border px-3 py-2 text-sm ${alerta.tone}`}>
              <p className="font-semibold">{alerta.title}</p>
              <p>{alerta.detail}</p>
            </div>
          ))}
        </div>
      )}

      <div className="mt-6 rounded-lg border border-border p-4">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-base font-semibold">Previsao e recomendacao de compra</h3>
            <p className="text-xs text-muted-foreground">
              Baseado em consumo medio, cobertura e lead time real por material.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => refetchForecast()}>
              Atualizar previsao
            </Button>
            <Button onClick={() => snapshotForecast.mutate()} disabled={snapshotForecast.isPending}>
              Salvar snapshot
            </Button>
          </div>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="rounded-md border border-border px-3 py-2">
            <p className="text-xs text-muted-foreground">Total monitorado</p>
            <p className="text-xl font-semibold">{resumoForecast.total}</p>
          </div>
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-900">
            <p className="text-xs">Risco alto</p>
            <p className="text-xl font-semibold">{resumoForecast.alto}</p>
          </div>
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
            <p className="text-xs">Risco medio</p>
            <p className="text-xl font-semibold">{resumoForecast.medio}</p>
          </div>
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-900">
            <p className="text-xs">Risco baixo</p>
            <p className="text-xl font-semibold">{resumoForecast.baixo}</p>
          </div>
        </div>

        {forecastRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sem dados de previsao para esta obra.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-3 py-2 text-left">Material</th>
                  <th className="px-3 py-2 text-right">Estoque</th>
                  <th className="px-3 py-2 text-right">Consumo/dia</th>
                  <th className="px-3 py-2 text-right">Cobertura (dias)</th>
                  <th className="px-3 py-2 text-right">Lead time</th>
                  <th className="px-3 py-2 text-left">Risco</th>
                  <th className="px-3 py-2 text-left">Recomendacao</th>
                  <th className="px-3 py-2 text-left">Data ideal pedido</th>
                </tr>
              </thead>
              <tbody>
                {forecastRows.map((item) => (
                  <tr key={item.material_id} className="border-t border-border">
                    <td className="px-3 py-2">
                      {item.material_nome}
                      <span className="ml-1 text-xs text-muted-foreground">({item.unidade})</span>
                      <p className="text-xs text-muted-foreground">{item.justificativa}</p>
                    </td>
                    <td className="px-3 py-2 text-right">{item.estoque_atual}</td>
                    <td className="px-3 py-2 text-right">{item.consumo_medio_diario}</td>
                    <td className="px-3 py-2 text-right">{item.dias_cobertura ?? "n/a"}</td>
                    <td className="px-3 py-2 text-right">{item.lead_time_real_dias}</td>
                    <td className="px-3 py-2">
                      <span
                        className={
                          item.risco === "alto"
                            ? "font-semibold text-destructive"
                            : item.risco === "medio"
                              ? "font-semibold text-amber-700"
                              : "font-semibold text-emerald-700"
                        }
                      >
                        {item.risco}
                      </span>
                    </td>
                    <td className="px-3 py-2">{item.recomendacao}</td>
                    <td className="px-3 py-2">
                      {item.data_pedido_ideal ? new Date(item.data_pedido_ideal).toLocaleDateString("pt-BR") : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <EstoqueSection
        obraId={obraId}
        onLoaded={(rows) => {
          setEstoqueRows(
            rows.map((item) => ({
              material_id: item.material_id,
              estoque_atual: item.estoque_atual,
              atualizado_por: item.atualizado_por,
              ultima_atualizacao_estoque: item.ultima_atualizacao_estoque,
              materiais: item.materiais,
            })),
          );
          if (!selectedMaterialId && rows.length > 0) {
            setSelectedMaterialId(rows[0].material_id);
          }
        }}
      />

      <div className="mt-8">
        <h3 className="mb-3 text-lg font-semibold">Historico de ajustes</h3>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Quando</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Material</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Tipo</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Anterior</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Delta</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Saldo</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Responsavel</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Motivo</th>
              </tr>
            </thead>
            <tbody>
              {ajustes.map((ajuste) => (
                <tr key={ajuste.id} className="border-t border-border">
                  <td className="px-4 py-3">{new Date(ajuste.created_at).toLocaleString("pt-BR")}</td>
                  <td className="px-4 py-3">{materialById[ajuste.material_id]?.nome ?? ajuste.material_id}</td>
                  <td className="px-4 py-3">{ajusteTypeLabels[ajuste.tipo] ?? ajuste.tipo}</td>
                  <td className="px-4 py-3 text-right">{ajuste.quantidade_anterior}</td>
                  <td className="px-4 py-3 text-right">{ajuste.delta}</td>
                  <td className="px-4 py-3 text-right">{ajuste.quantidade_resultante}</td>
                  <td className="px-4 py-3">
                    {ajuste.registrado_por ? (profileByUserId[ajuste.registrado_por] ?? ajuste.registrado_por) : "-"}
                  </td>
                  <td className="px-4 py-3">{ajuste.motivo ?? "-"}</td>
                </tr>
              ))}
              {ajustes.length === 0 && (
                <tr>
                  <td className="px-4 py-3 text-muted-foreground" colSpan={8}>
                    Nenhum ajuste manual registrado para esta obra.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </PageShell>
  );
};

export default EstoqueManager;
