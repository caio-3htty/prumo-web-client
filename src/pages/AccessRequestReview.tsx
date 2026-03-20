import { useEffect, useMemo, useState } from "react";
import { Check, PencilLine, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { getSupabaseFunctionErrorMessage } from "@/lib/supabaseFunctionError";

type ReviewDecision = "approve" | "reject" | "edit";
type AppRole = "master" | "gestor" | "engenheiro" | "operacional" | "almoxarife";

type RequestPayload = {
  id: string;
  requestType: "company_owner" | "company_internal";
  status: "pending" | "approved" | "rejected" | "edited";
  applicantEmail: string;
  applicantFullName: string;
  companyName: string;
  requestedUsername: string;
  requestedJobTitle: string;
  requestedRole: AppRole;
  requestedObraIds?: string[];
  allowedRoles?: AppRole[];
};

const roleOptions: Array<{ value: AppRole; label: string }> = [
  { value: "master", label: "Master" },
  { value: "gestor", label: "Gestor" },
  { value: "engenheiro", label: "Engenheiro" },
  { value: "operacional", label: "Operacional" },
  { value: "almoxarife", label: "Almoxarife" },
];

const AccessRequestReview = () => {
  const token = useMemo(() => new URLSearchParams(window.location.search).get("token")?.trim() ?? "", []);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [successText, setSuccessText] = useState("");
  const [requestData, setRequestData] = useState<RequestPayload | null>(null);
  const [allowedRoles, setAllowedRoles] = useState<AppRole[]>([]);
  const [reviewedUsername, setReviewedUsername] = useState("");
  const [reviewedJobTitle, setReviewedJobTitle] = useState("");
  const [reviewedRole, setReviewedRole] = useState<AppRole>("operacional");
  const [reviewNotes, setReviewNotes] = useState("");

  useEffect(() => {
    const loadRequest = async () => {
      if (!token) {
        setErrorText("Token de aprovacao ausente.");
        setLoading(false);
        return;
      }

      const { data, error } = await supabase.functions.invoke("account-access-request", {
        body: { action: "get_request", token },
      });

      if (error || !data?.ok) {
        const functionMessage = await getSupabaseFunctionErrorMessage(error, data);
        setErrorText(functionMessage ?? "Nao foi possivel carregar a solicitacao.");
        setLoading(false);
        return;
      }

      const nextRequest = data.request as RequestPayload;
      const nextAllowedRoles = Array.isArray(nextRequest.allowedRoles)
        ? (nextRequest.allowedRoles as AppRole[])
        : roleOptions.map((item) => item.value);

      setRequestData(nextRequest);
      setAllowedRoles(nextAllowedRoles);
      setReviewedUsername(nextRequest.requestedUsername);
      setReviewedJobTitle(nextRequest.requestedJobTitle);
      setReviewedRole(
        nextAllowedRoles.includes(nextRequest.requestedRole)
          ? nextRequest.requestedRole
          : (nextAllowedRoles[0] ?? "operacional"),
      );
      setLoading(false);
    };

    void loadRequest();
  }, [token]);

  const visibleRoleOptions = useMemo(() => {
    if (!allowedRoles.length) return [];
    return roleOptions.filter((item) => allowedRoles.includes(item.value));
  }, [allowedRoles]);

  const canReview = requestData?.status === "pending" && visibleRoleOptions.length > 0;

  const handleReview = async (decision: ReviewDecision) => {
    if (!requestData) return;
    if (!canReview) {
      setErrorText("Aprovador sem permissao para revisar esta solicitacao.");
      return;
    }

    setSubmitting(true);
    setErrorText("");
    setSuccessText("");

    const { data, error } = await supabase.functions.invoke("account-access-request", {
      body: {
        action: "review_request",
        token,
        decision,
        reviewedUsername,
        reviewedJobTitle,
        reviewedRole,
        reviewNotes,
      },
    });

    if (error || !data?.ok) {
      const functionMessage = await getSupabaseFunctionErrorMessage(error, data);
      setErrorText(functionMessage ?? "Falha ao processar a revisao.");
      setSubmitting(false);
      return;
    }

    setSuccessText(data.message ?? "Solicitacao processada com sucesso.");
    setRequestData((current) =>
      current
        ? {
            ...current,
            status: data.status ?? (decision === "reject" ? "rejected" : decision === "edit" ? "edited" : "approved"),
          }
        : current,
    );
    setSubmitting(false);
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-xl">
          <CardHeader>
            <CardTitle>Avaliacao de solicitacao</CardTitle>
          </CardHeader>
          <CardContent>Carregando...</CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle>Avaliacao de solicitacao de acesso</CardTitle>
          <CardDescription>
            A senha do usuario nunca e exibida neste fluxo. Aqui voce pode aprovar, rejeitar ou aprovar com edicao.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {errorText && <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">{errorText}</div>}
          {successText && <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm">{successText}</div>}

          {requestData && (
            <>
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <Label>Empresa</Label>
                  <Input value={requestData.companyName} disabled />
                </div>
                <div>
                  <Label>Tipo</Label>
                  <Input
                    value={requestData.requestType === "company_internal" ? "Conta interna da empresa" : "Conta empresa"}
                    disabled
                  />
                </div>
                <div>
                  <Label>E-mail do usuario</Label>
                  <Input value={requestData.applicantEmail} disabled />
                </div>
                <div>
                  <Label>Nome informado</Label>
                  <Input value={requestData.applicantFullName} disabled />
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="reviewedUsername">Usuario (nome exibido)</Label>
                  <Input
                    id="reviewedUsername"
                    value={reviewedUsername}
                    onChange={(event) => setReviewedUsername(event.target.value)}
                    disabled={submitting || requestData.status !== "pending"}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="reviewedJobTitle">Cargo</Label>
                  <Input
                    id="reviewedJobTitle"
                    value={reviewedJobTitle}
                    onChange={(event) => setReviewedJobTitle(event.target.value)}
                    disabled={submitting || requestData.status !== "pending"}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="reviewedRole">Perfil de acesso</Label>
                <select
                  id="reviewedRole"
                  value={reviewedRole}
                  onChange={(event) => setReviewedRole(event.target.value as AppRole)}
                  disabled={submitting || requestData.status !== "pending" || visibleRoleOptions.length === 0}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
                >
                  {visibleRoleOptions.map((role) => (
                    <option key={role.value} value={role.value}>
                      {role.label}
                    </option>
                  ))}
                </select>
                {requestData.status === "pending" && visibleRoleOptions.length === 0 && (
                  <p className="text-xs text-destructive">Sem permissao para aprovar este perfil/escopo.</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="reviewNotes">Observacoes</Label>
                <Input
                  id="reviewNotes"
                  value={reviewNotes}
                  onChange={(event) => setReviewNotes(event.target.value)}
                  placeholder="Motivo/recomendacao para aprovacao ou rejeicao"
                  disabled={submitting || requestData.status !== "pending"}
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={submitting || !canReview}
                  onClick={() => void handleReview("approve")}
                >
                  <Check className="h-4 w-4" /> Aprovar
                </Button>
                <Button
                  variant="outline"
                  disabled={submitting || !canReview}
                  onClick={() => void handleReview("edit")}
                >
                  <PencilLine className="h-4 w-4" /> Aprovar com edicao
                </Button>
                <Button
                  variant="destructive"
                  disabled={submitting || !canReview}
                  onClick={() => void handleReview("reject")}
                >
                  <X className="h-4 w-4" /> Rejeitar
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default AccessRequestReview;
