import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { z } from "zod";
import { toast } from "sonner";

import { DataTable } from "@/components/DataTable";
import { PageShell } from "@/components/PageShell";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { canManageCadastros } from "@/lib/rbac";

interface Fornecedor {
  id: string;
  nome: string;
  cnpj: string;
  contatos: string | null;
  entrega_propria: boolean;
  prazo_prometido_dias: number;
  prazo_real_medio_dias: number;
  confiabilidade: number;
  ultima_atualizacao: string;
  atualizado_por: string | null;
  created_at: string;
  deleted_at: string | null;
}

const CNPJ_DIGITS = 14;

const normalizeCnpj = (value: string) => value.replace(/\D/g, "").slice(0, CNPJ_DIGITS);

const formatCnpj = (value: string) => {
  const digits = normalizeCnpj(value);
  if (digits.length <= 2) return digits;
  if (digits.length <= 5) return `${digits.slice(0, 2)}.${digits.slice(2)}`;
  if (digits.length <= 8) return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5)}`;
  if (digits.length <= 12) {
    return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8)}`;
  }
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12, 14)}`;
};

const isValidCnpj = (value: string) => {
  const digits = normalizeCnpj(value);
  if (!/^\d{14}$/.test(digits)) return false;
  if (/^(\d)\1{13}$/.test(digits)) return false;

  const calcDigit = (base: string, size: number) => {
    let sum = 0;
    let weight = size - 7;

    for (let i = 0; i < size; i += 1) {
      sum += Number(base[i]) * weight;
      weight -= 1;
      if (weight < 2) weight = 9;
    }

    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };

  const firstDigit = calcDigit(digits, 12);
  const secondDigit = calcDigit(digits, 13);
  return firstDigit === Number(digits[12]) && secondDigit === Number(digits[13]);
};

const formSchema = z.object({
  nome: z.string().min(1, "Nome e obrigatorio"),
  cnpj: z
    .string()
    .min(CNPJ_DIGITS, "CNPJ deve conter 14 numeros")
    .refine((value) => /^\d{14}$/.test(value), "CNPJ deve conter apenas numeros")
    .refine((value) => isValidCnpj(value), "CNPJ invalido"),
  contatos: z.string().optional(),
  entrega_propria: z.boolean(),
  prazo_prometido_dias: z.string().optional(),
  prazo_real_medio_dias: z.string().optional(),
  confiabilidade: z.string().optional(),
});

const FornecedoresManager = () => {
  const queryClient = useQueryClient();
  const { user, role } = useAuth();
  const canManage = canManageCadastros(role);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Fornecedor | null>(null);
  const [form, setForm] = useState({
    nome: "",
    cnpj: "",
    contatos: "",
    entrega_propria: false,
    prazo_prometido_dias: "0",
    prazo_real_medio_dias: "0",
    confiabilidade: "1",
  });
  const [showTrash, setShowTrash] = useState(false);
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data: fornecedores = [], isLoading } = useQuery({
    queryKey: ["fornecedores", showTrash],
    queryFn: async () => {
      let query = supabase.from("fornecedores").select("*").order("nome");

      if (showTrash) {
        query = query.not("deleted_at", "is", null).gte("deleted_at", cutoff);
      } else {
        query = query.is("deleted_at", null);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as Fornecedor[];
    },
  });

  const upsert = useMutation({
    mutationFn: async (values: typeof form & { id?: string }) => {
      const payload = {
        ...values,
        prazo_prometido_dias: Math.max(0, Number(values.prazo_prometido_dias) || 0),
        prazo_real_medio_dias: Math.max(0, Number(values.prazo_real_medio_dias) || 0),
        confiabilidade: Math.min(1, Math.max(0, Number(values.confiabilidade) || 0)),
        ultima_atualizacao: new Date().toISOString(),
        atualizado_por: user?.id,
      };

      if (values.id) {
        const { error } = await supabase.from("fornecedores").update(payload).eq("id", values.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("fornecedores").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["fornecedores", showTrash] });
      toast.success(editing ? "Fornecedor atualizado" : "Fornecedor criado");
      closeDialog();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const softDelete = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("fornecedores")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["fornecedores", showTrash] });
      toast.success("Fornecedor enviado para a lixeira");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const hardDelete = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("fornecedores").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["fornecedores", showTrash] });
      toast.success("Fornecedor excluido permanentemente");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const restore = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("fornecedores").update({ deleted_at: null }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["fornecedores", showTrash] });
      toast.success("Fornecedor restaurado");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const openNew = () => {
    setEditing(null);
    setForm({
      nome: "",
      cnpj: "",
      contatos: "",
      entrega_propria: false,
      prazo_prometido_dias: "0",
      prazo_real_medio_dias: "0",
      confiabilidade: "1",
    });
    setOpen(true);
  };

  const openEdit = (fornecedor: Fornecedor) => {
    setEditing(fornecedor);
    setForm({
      nome: fornecedor.nome,
      cnpj: normalizeCnpj(fornecedor.cnpj),
      contatos: fornecedor.contatos ?? "",
      entrega_propria: fornecedor.entrega_propria,
      prazo_prometido_dias: String(fornecedor.prazo_prometido_dias ?? 0),
      prazo_real_medio_dias: String(fornecedor.prazo_real_medio_dias ?? 0),
      confiabilidade: String(fornecedor.confiabilidade ?? 1),
    });
    setOpen(true);
  };

  const closeDialog = () => {
    setOpen(false);
    setEditing(null);
  };

  const handleSubmit = async () => {
    const normalizedForm = {
      ...form,
      cnpj: normalizeCnpj(form.cnpj),
    };

    const parsed = formSchema.safeParse(normalizedForm);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Dados invalidos");
      return;
    }

    const confiabilidade = Number(normalizedForm.confiabilidade);
    if (!Number.isFinite(confiabilidade) || confiabilidade < 0 || confiabilidade > 1) {
      toast.error("Confiabilidade deve ficar entre 0 e 1.");
      return;
    }

    const cnpjCandidates = Array.from(
      new Set([normalizedForm.cnpj, formatCnpj(normalizedForm.cnpj)].filter(Boolean)),
    );
    let duplicateQuery = supabase
      .from("fornecedores")
      .select("id")
      .in("cnpj", cnpjCandidates)
      .limit(1);

    if (editing) {
      duplicateQuery = duplicateQuery.neq("id", editing.id);
    }

    const { data: existing, error } = await duplicateQuery;
    if (error) {
      toast.error(error.message);
      return;
    }
    if (existing && existing.length > 0) {
      toast.error("CNPJ ja cadastrado");
      return;
    }

    upsert.mutate(editing ? { ...normalizedForm, id: editing.id } : normalizedForm);
  };

  const columns = [
    { key: "nome", label: "Nome" },
    {
      key: "cnpj",
      label: "CNPJ",
      render: (item: Fornecedor) => formatCnpj(item.cnpj),
    },
    { key: "contatos", label: "Contatos" },
    ...(showTrash
      ? [
          {
            key: "deleted_at",
            label: "Excluido em",
            render: (item: Fornecedor) =>
              item.deleted_at ? new Date(item.deleted_at).toLocaleString("pt-BR") : "",
          },
        ]
      : []),
    {
      key: "entrega_propria",
      label: "Entrega Propria",
      render: (item: Fornecedor) =>
        item.entrega_propria ? (
          <Check className="h-4 w-4 text-success" />
        ) : (
          <X className="h-4 w-4 text-muted-foreground" />
        ),
    },
    {
      key: "prazo_prometido_dias",
      label: "Prazo prometido",
      render: (item: Fornecedor) => `${item.prazo_prometido_dias ?? 0} dias`,
    },
    {
      key: "prazo_real_medio_dias",
      label: "Prazo real",
      render: (item: Fornecedor) => `${item.prazo_real_medio_dias ?? 0} dias`,
    },
    {
      key: "confiabilidade",
      label: "Confiabilidade",
      render: (item: Fornecedor) => `${Math.round((item.confiabilidade ?? 0) * 100)}%`,
    },
    ...(canManage
      ? [
          {
            key: "_actions",
            label: "Acoes",
            render: (item: Fornecedor) => (
              <div className="flex gap-1">
                {showTrash ? (
                  <>
                    <Button variant="ghost" size="icon" onClick={() => restore.mutate(item.id)}>
                      <Plus className="h-4 w-4 text-success" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => hardDelete.mutate(item.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </>
                ) : (
                  <>
                    <Button variant="ghost" size="icon" onClick={() => openEdit(item)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => softDelete.mutate(item.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </>
                )}
              </div>
            ),
          },
        ]
      : []),
  ];

  return (
    <PageShell title="Fornecedores">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">
            {showTrash ? "Lixeira de Fornecedores" : "Gerenciar Fornecedores"}
          </h2>
          <p className="text-muted-foreground">
            {showTrash ? "Registros apagados (30 dias)" : ""}
          </p>
        </div>
        {canManage && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setShowTrash(!showTrash)}>
              {showTrash ? "Mostrar ativos" : "Ver lixeira"}
            </Button>
            {!showTrash && (
              <Button onClick={openNew}>
                <Plus className="mr-1 h-4 w-4" />
                Novo Fornecedor
              </Button>
            )}
          </div>
        )}
      </div>

      {isLoading ? (
        <p className="text-muted-foreground">Carregando...</p>
      ) : (
        <DataTable
          data={fornecedores}
          columns={columns}
          searchKeys={["nome", "cnpj"]}
          searchPlaceholder="Buscar fornecedores..."
        />
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Editar Fornecedor" : "Novo Fornecedor"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Nome *</Label>
              <Input value={form.nome} onChange={(event) => setForm({ ...form, nome: event.target.value })} />
            </div>
            <div>
              <Label>CNPJ *</Label>
              <Input
                value={formatCnpj(form.cnpj)}
                onChange={(event) => setForm({ ...form, cnpj: normalizeCnpj(event.target.value) })}
                placeholder="00.000.000/0000-00"
                inputMode="numeric"
                autoComplete="off"
              />
            </div>
            <div>
              <Label>Contatos</Label>
              <Input
                value={form.contatos}
                onChange={(event) => setForm({ ...form, contatos: event.target.value })}
                placeholder="Email, telefone..."
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <Label>Prazo prometido (dias)</Label>
                <Input
                  type="number"
                  min={0}
                  value={form.prazo_prometido_dias}
                  onChange={(event) =>
                    setForm({ ...form, prazo_prometido_dias: event.target.value })
                  }
                />
              </div>
              <div>
                <Label>Prazo real medio (dias)</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.1"
                  value={form.prazo_real_medio_dias}
                  onChange={(event) =>
                    setForm({ ...form, prazo_real_medio_dias: event.target.value })
                  }
                />
              </div>
              <div>
                <Label>Confiabilidade (0 a 1)</Label>
                <Input
                  type="number"
                  min={0}
                  max={1}
                  step="0.01"
                  value={form.confiabilidade}
                  onChange={(event) => setForm({ ...form, confiabilidade: event.target.value })}
                />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Switch
                checked={form.entrega_propria}
                onCheckedChange={(checked) => setForm({ ...form, entrega_propria: checked })}
              />
              <Label>Entrega propria</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>
              Cancelar
            </Button>
            <Button onClick={handleSubmit} disabled={upsert.isPending}>
              {editing ? "Salvar" : "Criar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
};

export default FornecedoresManager;
