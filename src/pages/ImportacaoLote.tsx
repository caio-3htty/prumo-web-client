import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileSpreadsheet, RefreshCcw, Upload } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";

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

type ImportEntityType =
  | "fornecedores"
  | "materiais"
  | "material_fornecedor"
  | "estoque_inicial"
  | "obras"
  | "usuarios";

type ImportPreviewResponse = {
  job_id: string;
  status: "preview_ready" | "preview_error";
  summary: {
    rows_total: number;
    critical_errors: number;
    warnings: number;
  };
  errors: Array<Record<string, unknown>>;
  warnings: Array<Record<string, unknown>>;
  preview_rows: Array<Record<string, unknown>>;
};

const entityLabels: Record<ImportEntityType, string> = {
  fornecedores: "Fornecedores",
  materiais: "Materiais",
  material_fornecedor: "Material x Fornecedor",
  estoque_inicial: "Estoque inicial",
  obras: "Obras",
  usuarios: "Usuarios (admin)",
};

const templateRowsByEntity: Record<ImportEntityType, Array<Record<string, unknown>>> = {
  fornecedores: [
    {
      nome: "Fornecedor Exemplo",
      cnpj: "12345678000190",
      contatos: "compras@fornecedor.com",
      entrega_propria: "true",
      prazo_prometido_dias: 7,
      prazo_real_medio_dias: 8,
      confiabilidade: 0.9,
    },
  ],
  materiais: [
    {
      nome: "Cimento CP-II",
      unidade: "saco",
      estoque_minimo: 20,
      estoque_seguranca: 10,
      criticidade: "alta",
      consumo_medio_diario: 5,
      tempo_producao_padrao: 0,
    },
  ],
  material_fornecedor: [
    {
      material_nome: "Cimento CP-II",
      fornecedor_cnpj: "12345678000190",
      preco_atual: 35.5,
      pedido_minimo: 10,
      lead_time_dias: 5,
      lead_time_real_dias: 6,
      fornecedor_preferencial: "true",
    },
  ],
  estoque_inicial: [
    {
      obra_nome: "Obra Centro",
      material_nome: "Cimento CP-II",
      saldo: 120,
      motivo: "Carga inicial",
    },
  ],
  obras: [
    {
      name: "Obra Centro",
      description: "Fase estrutural",
      address: "Rua Exemplo, 100",
      status: "ativa",
    },
  ],
  usuarios: [
    {
      email: "novo.usuario@empresa.com",
      full_name: "Novo Usuario",
      job_title: "Operacional",
      role: "operacional",
      phone: "11999999999",
      obra_names: "Obra Centro;Obra Norte",
      temp_password: "Temp@12345",
    },
  ],
};

const parseWorksheet = (buffer: ArrayBuffer): Array<Record<string, unknown>> => {
  const workbook = XLSX.read(buffer, { type: "array" });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) return [];
  const worksheet = workbook.Sheets[firstSheetName];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
    defval: "",
    raw: false,
  });
};

const normalizeRowsForEntity = (rows: Array<Record<string, unknown>>, entity: ImportEntityType) => {
  if (entity !== "usuarios") {
    return rows;
  }

  return rows.map((row) => {
    const obraNamesRaw = String(row.obra_names ?? "").trim();
    const obraNames = obraNamesRaw
      ? obraNamesRaw
          .split(/[;,]/g)
          .map((item) => item.trim())
          .filter(Boolean)
      : [];

    return {
      ...row,
      obra_names: obraNames,
    };
  });
};

const ImportacaoLote = () => {
  const queryClient = useQueryClient();
  const { can, tenantId } = useAuth();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabaseAny = supabase as any;

  const [entityType, setEntityType] = useState<ImportEntityType>("fornecedores");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreviewResponse | null>(null);

  const hasImportPermission = can("users.manage") || can("import.manage");

  const { data: importJobs = [], refetch: refetchJobs } = useQuery({
    queryKey: ["import-jobs", entityType],
    enabled: hasImportPermission,
    queryFn: async () => {
      const { data, error } = await supabaseAny
        .from("import_jobs")
        .select("id, entity_type, status, file_name, summary, committed_count, created_at, committed_at")
        .eq("entity_type", entityType)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data ?? [];
    },
  });

  const previewMutation = useMutation({
    mutationFn: async () => {
      if (!selectedFile) {
        throw new Error("Selecione um arquivo .xlsx antes de enviar.");
      }

      const buffer = await selectedFile.arrayBuffer();
      const rawRows = parseWorksheet(buffer);
      if (rawRows.length === 0) {
        throw new Error("A planilha esta vazia.");
      }

      const normalizedRows = normalizeRowsForEntity(rawRows, entityType);
      const { data, error } = await supabaseAny.rpc("import_preview_rows", {
        _entity_type: entityType,
        _file_name: selectedFile.name,
        _rows: normalizedRows,
      });

      if (error) throw error;
      return data as ImportPreviewResponse;
    },
    onSuccess: (data) => {
      setPreview(data);
      queryClient.invalidateQueries({ queryKey: ["import-jobs", entityType] });
      if (data.status === "preview_ready") {
        toast.success("Previa gerada com sucesso.");
      } else {
        toast.error("Previa com erros criticos. Corrija a planilha antes do commit.");
      }
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const commitMutation = useMutation({
    mutationFn: async () => {
      if (!preview?.job_id) {
        throw new Error("Execute a previa antes de confirmar.");
      }
      if (preview.status !== "preview_ready") {
        throw new Error("A previa possui erros criticos e nao pode ser confirmada.");
      }

      if (entityType === "usuarios") {
        if (!tenantId) {
          throw new Error("Tenant nao identificado para provisionar usuarios.");
        }

        const { data: jobData, error: jobError } = await supabaseAny
          .from("import_jobs")
          .select("normalized_rows")
          .eq("id", preview.job_id)
          .maybeSingle();
        if (jobError) throw jobError;

        const rows = (jobData?.normalized_rows ?? []) as Array<Record<string, unknown>>;
        if (!Array.isArray(rows) || rows.length === 0) {
          throw new Error("Job de usuarios sem linhas para provisionar.");
        }

        const emailList = rows
          .map((row) => String(row.email ?? "").trim().toLowerCase())
          .filter(Boolean);
        const duplicatedInFile = emailList.filter((email, idx) => emailList.indexOf(email) !== idx);
        if (duplicatedInFile.length > 0) {
          throw new Error(`E-mails duplicados no arquivo: ${Array.from(new Set(duplicatedInFile)).join(", ")}`);
        }

        const { data: obrasData, error: obrasError } = await supabaseAny
          .from("obras")
          .select("id, name")
          .eq("tenant_id", tenantId)
          .is("deleted_at", null);
        if (obrasError) throw obrasError;
        const obraIdByName = new Map<string, string>();
        (obrasData ?? []).forEach((obra: { id: string; name: string }) => {
          obraIdByName.set(obra.name.trim().toLowerCase(), obra.id);
        });

        const { data: existingProfiles, error: existingProfilesError } = await supabaseAny
          .from("profiles")
          .select("email")
          .eq("tenant_id", tenantId)
          .in("email", emailList);
        if (existingProfilesError) throw existingProfilesError;
        const existingEmails = new Set(
          (existingProfiles ?? [])
            .map((row: { email: string | null }) => String(row.email ?? "").trim().toLowerCase())
            .filter(Boolean),
        );
        if (existingEmails.size > 0) {
          throw new Error(
            `Os seguintes e-mails ja existem no tenant e devem ser gerenciados pela tela de Usuarios: ${Array.from(existingEmails).join(", ")}`,
          );
        }

        const { data: actorData, error: actorError } = await supabase.auth.getUser();
        if (actorError) throw actorError;
        const actorUserId = actorData.user?.id;
        if (!actorUserId) {
          throw new Error("Sessao expirada para validacao de permissao de importacao.");
        }

        for (let index = 0; index < rows.length; index += 1) {
          const row = rows[index];
          const obraNames = Array.isArray(row.obra_names) ? (row.obra_names as string[]) : [];
          const obraIds = obraNames
            .map((name) => obraIdByName.get(String(name).trim().toLowerCase()))
            .filter(Boolean) as string[];

          if (obraNames.length > 0 && obraIds.length !== obraNames.length) {
            throw new Error(`Linha ${index + 1}: existe obra no arquivo que nao foi encontrada no tenant.`);
          }

          const { data: canAssign, error: canAssignError } = await supabaseAny.rpc("can_assign_role", {
            _actor_user_id: actorUserId,
            _tenant_id: tenantId,
            _target_role: String(row.role ?? "operacional"),
            _obra_ids: obraIds,
          });
          if (canAssignError) throw canAssignError;
          if (!canAssign) {
            throw new Error(`Linha ${index + 1}: sem permissao para atribuir role ${String(row.role ?? "-")}.`);
          }

          const { data: provisionData, error: provisionError } = await supabase.functions.invoke("admin-user-provision", {
            body: {
              tenant_id: tenantId,
              email: String(row.email ?? ""),
              full_name: String(row.full_name ?? ""),
              job_title: String(row.job_title ?? ""),
              phone: String(row.phone ?? ""),
              role: String(row.role ?? "operacional"),
              temp_password: String(row.temp_password ?? ""),
              obra_ids: obraIds,
            },
          });

          if (provisionError || !provisionData?.ok) {
            throw new Error(
              `Linha ${index + 1}: ${provisionData?.message ?? provisionError?.message ?? "falha ao provisionar usuario"}`,
            );
          }
        }

        const { error: markCommittedError } = await supabaseAny
          .from("import_jobs")
          .update({
            status: "committed",
            committed_count: rows.length,
            committed_at: new Date().toISOString(),
          })
          .eq("id", preview.job_id);
        if (markCommittedError) throw markCommittedError;

        return { committed_count: rows.length, entity_type: entityType };
      }

      const { data, error } = await supabaseAny.rpc("import_commit_job", {
        _job_id: preview.job_id,
      });
      if (error) throw error;
      return data as { committed_count?: number; entity_type?: string };
    },
    onSuccess: (data) => {
      toast.success("Importacao confirmada.", {
        description: `${data?.committed_count ?? 0} registros aplicados em ${data?.entity_type ?? entityType}.`,
      });
      refetchJobs();
      setSelectedFile(null);
      setPreview(null);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const previewColumns = useMemo(() => {
    if (!preview?.preview_rows?.length) return [] as string[];
    return Object.keys(preview.preview_rows[0]);
  }, [preview]);

  const handleDownloadTemplate = () => {
    const rows = templateRowsByEntity[entityType];
    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "template");
    XLSX.writeFile(workbook, `template-import-${entityType}.xlsx`);
  };

  return (
    <PageShell title="Importacao em Lote">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold">Importacao Excel com previa</h2>
          <p className="text-sm text-muted-foreground">
            Fluxo oficial: template, upload, previa com validacao, commit e trilha auditavel.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleDownloadTemplate}>
            <Download className="mr-1 h-4 w-4" /> Baixar template
          </Button>
          <Button variant="outline" onClick={() => refetchJobs()}>
            <RefreshCcw className="mr-1 h-4 w-4" /> Atualizar jobs
          </Button>
        </div>
      </div>

      <div className="rounded-lg border border-border p-4">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label>Entidade</Label>
            <Select value={entityType} onValueChange={(value) => setEntityType(value as ImportEntityType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(entityLabels) as ImportEntityType[]).map((key) => (
                  <SelectItem key={key} value={key}>
                    {entityLabels[key]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2 md:col-span-2">
            <Label>Arquivo Excel (.xlsx)</Label>
            <Input
              type="file"
              accept=".xlsx"
              onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
            />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={() => previewMutation.mutate()} disabled={previewMutation.isPending || !selectedFile}>
            <Upload className="mr-1 h-4 w-4" /> Gerar previa
          </Button>
          <Button
            variant="secondary"
            onClick={() => commitMutation.mutate()}
            disabled={commitMutation.isPending || !preview || preview.status !== "preview_ready"}
          >
            <FileSpreadsheet className="mr-1 h-4 w-4" /> Confirmar importacao
          </Button>
        </div>
      </div>

      {preview && (
        <div className="mt-6 space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-border p-3">
              <p className="text-xs uppercase text-muted-foreground">Linhas totais</p>
              <p className="text-2xl font-semibold">{preview.summary.rows_total}</p>
            </div>
            <div className="rounded-lg border border-border p-3">
              <p className="text-xs uppercase text-muted-foreground">Erros criticos</p>
              <p className="text-2xl font-semibold text-destructive">{preview.summary.critical_errors}</p>
            </div>
            <div className="rounded-lg border border-border p-3">
              <p className="text-xs uppercase text-muted-foreground">Warnings</p>
              <p className="text-2xl font-semibold">{preview.summary.warnings}</p>
            </div>
          </div>

          {preview.errors.length > 0 && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
              <p className="mb-2 text-sm font-semibold text-destructive">Erros criticos</p>
              <ul className="space-y-1 text-sm">
                {preview.errors.slice(0, 20).map((errorItem, index) => (
                  <li key={`err-${index}`}>
                    Linha {String(errorItem.row ?? "?")}: {String(errorItem.field ?? "campo")} - {String(errorItem.message ?? "erro")}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {preview.warnings.length > 0 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900">
              <p className="mb-2 text-sm font-semibold">Warnings</p>
              <ul className="space-y-1 text-sm">
                {preview.warnings.slice(0, 20).map((warnItem, index) => (
                  <li key={`warn-${index}`}>
                    Linha {String(warnItem.row ?? "?")}: {String(warnItem.field ?? "campo")} - {String(warnItem.message ?? "aviso")}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="rounded-lg border border-border p-3">
            <p className="mb-2 text-sm font-semibold">Previa (max 20 linhas)</p>
            {preview.preview_rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sem linhas para exibir.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      {previewColumns.map((column) => (
                        <th key={column} className="px-2 py-2 text-left font-medium text-muted-foreground">
                          {column}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.preview_rows.map((row, rowIndex) => (
                      <tr key={`row-${rowIndex}`} className="border-b border-border/50">
                        {previewColumns.map((column) => (
                          <td key={`${rowIndex}-${column}`} className="px-2 py-2 align-top">
                            {Array.isArray(row[column])
                              ? (row[column] as unknown[]).join(", ")
                              : String(row[column] ?? "")}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="mt-8">
        <h3 className="mb-3 text-base font-semibold">Historico de importacoes ({entityLabels[entityType]})</h3>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-3 py-2 text-left">Data</th>
                <th className="px-3 py-2 text-left">Arquivo</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-right">Linhas</th>
                <th className="px-3 py-2 text-right">Erros</th>
                <th className="px-3 py-2 text-right">Commit</th>
              </tr>
            </thead>
            <tbody>
              {importJobs.map((job: Record<string, unknown>) => {
                const summary = (job.summary as Record<string, unknown>) ?? {};
                return (
                  <tr key={String(job.id)} className="border-t border-border">
                    <td className="px-3 py-2">{new Date(String(job.created_at)).toLocaleString("pt-BR")}</td>
                    <td className="px-3 py-2">{String(job.file_name ?? "-")}</td>
                    <td className="px-3 py-2">{String(job.status ?? "-")}</td>
                    <td className="px-3 py-2 text-right">{Number(summary.rows_total ?? 0)}</td>
                    <td className="px-3 py-2 text-right">{Number(summary.critical_errors ?? 0)}</td>
                    <td className="px-3 py-2 text-right">{Number(job.committed_count ?? 0)}</td>
                  </tr>
                );
              })}
              {importJobs.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-3 text-muted-foreground">
                    Nenhuma importacao registrada para esta entidade.
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

export default ImportacaoLote;
