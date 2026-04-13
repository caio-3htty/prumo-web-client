import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

interface EstoqueItem {
  id: string;
  obra_id: string;
  material_id: string;
  estoque_atual: number;
  atualizado_em: string;
  ultima_atualizacao_estoque: string | null;
  atualizado_por: string | null;
  confiabilidade: number | null;
  obras: { name: string } | null;
  materiais: { nome: string; unidade: string; estoque_minimo: number; estoque_seguranca: number } | null;
}

interface EstoqueSectionProps {
  obraId?: string;
  title?: string;
  onLoaded?: (items: EstoqueItem[]) => void;
}

export const EstoqueSection = ({ obraId, title = "Estoque Atual", onLoaded }: EstoqueSectionProps) => {
  const resolveConfiabilidade = (item: EstoqueItem) => {
    if (typeof item.confiabilidade === "number") {
      return Math.max(0, Math.min(1, item.confiabilidade));
    }
    const ref = item.ultima_atualizacao_estoque ?? item.atualizado_em;
    const hours = Math.max(0, (Date.now() - new Date(ref).getTime()) / (1000 * 60 * 60));
    return Math.max(0, Math.min(1, 1 - hours / 72));
  };

  const isOutdated = (item: EstoqueItem) => {
    const ref = item.ultima_atualizacao_estoque ?? item.atualizado_em;
    const hours = (Date.now() - new Date(ref).getTime()) / (1000 * 60 * 60);
    return hours >= 24;
  };

  const getCoverageStatus = (item: EstoqueItem) => {
    if (item.estoque_atual <= 0) {
      return { label: "zerado real", tone: "bg-red-100 text-red-800" };
    }

    if (isOutdated(item)) {
      return { label: "desatualizado", tone: "bg-amber-100 text-amber-800" };
    }

    const limite = (item.materiais?.estoque_minimo ?? 0) + (item.materiais?.estoque_seguranca ?? 0);
    if (item.estoque_atual <= limite) {
      return { label: "insuficiente para cobertura", tone: "bg-orange-100 text-orange-800" };
    }

    return { label: "cobertura ok", tone: "bg-emerald-100 text-emerald-800" };
  };

  const { data: estoque = [], isLoading } = useQuery({
    queryKey: ["estoque_obra_material", obraId],
    queryFn: async () => {
      let query = supabase
        .from("estoque_obra_material")
        .select("*, obras(name), materiais(nome, unidade, estoque_minimo, estoque_seguranca)")
        .order("atualizado_em", { ascending: false });

      if (obraId) {
        query = query.eq("obra_id", obraId);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as unknown as EstoqueItem[];
    },
  });

  useEffect(() => {
    if (onLoaded) {
      onLoaded(estoque);
    }
  }, [estoque, onLoaded]);

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Carregando estoque...</p>;
  }

  if (estoque.length === 0) {
    return <p className="text-sm text-muted-foreground">Sem estoque registrado.</p>;
  }

  return (
    <div className="mt-8">
      <h3 className="mb-4 text-lg font-semibold">{title}</h3>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              {!obraId && (
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Obra</th>
              )}
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Material</th>
              <th className="px-4 py-3 text-right font-medium text-muted-foreground">Estoque Atual</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Ultima atualizacao</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Atualizado por</th>
              <th className="px-4 py-3 text-right font-medium text-muted-foreground">Confiabilidade</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status operacional</th>
            </tr>
          </thead>
          <tbody>
            {estoque.map((item) => (
              <tr key={item.id} className="border-t border-border hover:bg-muted/30 transition-colors">
                {!obraId && <td className="px-4 py-3">{item.obras?.name}</td>}
                <td className="px-4 py-3">
                  {item.materiais?.nome}
                  <span className="ml-1 text-xs text-muted-foreground">({item.materiais?.unidade})</span>
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{item.estoque_atual}</td>
                <td className="px-4 py-3 text-xs">
                  {new Date(item.ultima_atualizacao_estoque ?? item.atualizado_em).toLocaleString("pt-BR")}
                  {isOutdated(item) && (
                    <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">
                      desatualizado
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-xs font-mono">
                  {item.atualizado_por ? item.atualizado_por.slice(0, 8) : "-"}
                </td>
                <td className="px-4 py-3 text-right text-xs font-semibold">
                  {`${Math.round(resolveConfiabilidade(item) * 100)}%`}
                </td>
                <td className="px-4 py-3 text-xs">
                  <span className={`rounded px-2 py-1 font-medium ${getCoverageStatus(item).tone}`}>
                    {getCoverageStatus(item).label}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
