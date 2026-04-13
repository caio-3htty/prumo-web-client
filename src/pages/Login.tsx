import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LogIn, UserPlus } from "lucide-react";
import { toast } from "sonner";

import logoPrumo from "@/assets/image.png";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/i18n/useI18n";
import { supabase } from "@/integrations/supabase/client";
import { getSupabaseFunctionErrorMessage } from "@/lib/supabaseFunctionError";
import {
  hasValidationErrors,
  normalizePhone,
  sanitizeUserFieldInput,
  type SignupMode,
  validateSignupInput,
} from "@/lib/userInputValidation";

type AppRole = "master" | "gestor" | "engenheiro" | "operacional" | "almoxarife";
type CompanySuggestion = {
  id: string;
  tenant_id?: string;
  name: string;
  slug: string | null;
  score?: number;
};

const roleOptions: Array<{ value: AppRole; label: string }> = [
  { value: "master", label: "Master" },
  { value: "gestor", label: "Gestor" },
  { value: "engenheiro", label: "Engenheiro" },
  { value: "operacional", label: "Operacional" },
  { value: "almoxarife", label: "Almoxarife" },
];

const Login = () => {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [signupMode, setSignupMode] = useState<SignupMode>("company_owner");
  const [companyName, setCompanyName] = useState("");
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [companySuggestions, setCompanySuggestions] = useState<CompanySuggestion[]>([]);
  const [selectedCompany, setSelectedCompany] = useState<CompanySuggestion | null>(null);
  const [loadingCompanies, setLoadingCompanies] = useState(false);
  const [username, setUsername] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [phone, setPhone] = useState("");
  const [requestedRole, setRequestedRole] = useState<AppRole>("operacional");
  const [attemptedSubmit, setAttemptedSubmit] = useState(false);
  const [loading, setLoading] = useState(false);
  const { t } = useI18n();

  const signupErrors = isSignUp
    ? validateSignupInput({
        fullName,
        companyName,
        username,
        jobTitle,
        email,
        phone,
        password,
        signupMode,
        tenantId,
      })
    : {};
  const hasSignupErrors = isSignUp && hasValidationErrors(signupErrors);

  useEffect(() => {
    if (!authLoading && user) {
      navigate("/", { replace: true });
    }
  }, [authLoading, navigate, user]);

  useEffect(() => {
    if (signupMode === "company_owner" || !isSignUp) {
      setTenantId(null);
      setSelectedCompany(null);
      setCompanySuggestions([]);
      setLoadingCompanies(false);
      return;
    }

    const query = companyName.trim();
    if (query.length < 3) {
      setCompanySuggestions([]);
      setLoadingCompanies(false);
      return;
    }

    const timer = window.setTimeout(async () => {
      setLoadingCompanies(true);
      const { data, error } = await supabase.functions.invoke("account-access-request", {
        body: { action: "search_companies", query },
      });

      if (error || !data?.ok) {
        setCompanySuggestions([]);
      } else {
        const companies = Array.isArray(data.companies) ? (data.companies as CompanySuggestion[]) : [];
        setCompanySuggestions(companies);
      }
      setLoadingCompanies(false);
    }, 250);

    return () => window.clearTimeout(timer);
  }, [companyName, isSignUp, signupMode]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    try {
      if (isSignUp) {
        setAttemptedSubmit(true);
        if (hasSignupErrors) {
          toast.error("Revise os campos do cadastro", {
            description: "Corrija os campos destacados antes de enviar.",
          });
          return;
        }

        setLoading(true);
        const action = signupMode === "company_owner" ? "register_company" : "register_internal";
        const payload = {
          action,
          email: email.trim().toLowerCase(),
          password,
          fullName: fullName.trim(),
          username: (username.trim() || fullName.trim()),
          companyName: companyName.trim(),
          tenantId: signupMode === "company_internal" ? tenantId : null,
          jobTitle: jobTitle.trim(),
          phone: normalizePhone(phone) || null,
          requestedRole: signupMode === "company_owner" ? "master" : requestedRole,
          origin: window.location.origin,
        };

        const { data, error } = await supabase.functions.invoke("account-access-request", {
          body: payload,
        });

        if (error || !data?.ok) {
          const functionMessage = await getSupabaseFunctionErrorMessage(error, data);
          const errorCode = String(data?.code ?? "").toLowerCase();
          const message = functionMessage?.toLowerCase() ?? "";
          const normalizedMessage = message.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

          if (
            errorCode.includes("invalid_phone_format") ||
            errorCode.includes("phone_length_invalid")
          ) {
            toast.error("Telefone invalido", {
              description: "Informe apenas numeros, entre 10 e 13 digitos.",
            });
          } else if (errorCode.includes("email_delivery_failed")) {
            toast.error("Cadastro nao concluido", {
              description:
                "O e-mail de boas-vindas nao foi enviado. Tente novamente em instantes.",
            });
          } else if (
            errorCode.includes("invalid_email_format") ||
            errorCode.includes("email_length_invalid")
          ) {
            toast.error("E-mail invalido", {
              description: "Revise o formato do e-mail informado.",
            });
          } else if (normalizedMessage.includes("empresa") && normalizedMessage.includes("nao encontrada")) {
            toast.error("Empresa nao encontrada", {
              description: "Confira o nome da empresa ou solicite primeiro a criacao da conta empresa.",
            });
          } else if (errorCode.includes("tenant_required")) {
            toast.error("Selecione uma empresa da lista", {
              description: "Para conta interna, escolha uma empresa valida antes de enviar.",
            });
          } else if (normalizedMessage.includes("empresa") && normalizedMessage.includes("ja existe")) {
            toast.error("Empresa ja cadastrada", {
              description: "Use o fluxo de conta interna para solicitar acesso.",
            });
          } else if (normalizedMessage.includes("ja esta cadastrado") || normalizedMessage.includes("already")) {
            toast.error("E-mail ja cadastrado", {
              description: "Use outro e-mail ou recupere a senha da conta existente.",
            });
          } else {
            toast.error(functionMessage ?? "Erro ao criar solicitacao.", {
              description: t("createAccountError"),
            });
          }
        } else {
          if (signupMode === "company_owner") {
            toast.success("Conta empresa criada", {
              description: "A conta master foi criada com sucesso. Faca login para continuar.",
            });
            setAttemptedSubmit(false);
          } else {
            toast.success("Solicitacao enviada", {
              description:
                "A empresa recebeu um e-mail para aprovar, rejeitar ou editar seu usuario e cargo. A senha nao e compartilhada.",
            });
            setAttemptedSubmit(false);
          }
        }
      } else {
        setLoading(true);
        const { error } = await supabase.auth.signInWithPassword({ email, password });

        if (error) {
          const message = error.message.toLowerCase();
          if (message.includes("invalid login credentials")) {
            toast.error("Credenciais invalidas", {
              description: "E-mail/senha incorretos ou conta ainda nao existe neste ambiente.",
            });
          } else if (message.includes("email not confirmed")) {
            toast.error("E-mail nao confirmado", {
              description: "Confirme seu e-mail antes de entrar.",
            });
          } else {
            toast.error(error.message, { description: t("signInError") });
          }
        }
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md animate-fade-in">
        <div className="mb-8 text-center">
          <div className="mb-3 flex justify-end">
            <LanguageSwitcher />
          </div>
          <img src={logoPrumo} alt="Prumo" className="mx-auto mb-4 h-16 object-contain" />
          <p className="mt-1 text-muted-foreground">{t("centralControl")}</p>
        </div>

        <Card className="border-border/50 shadow-lg">
          <CardHeader className="space-y-1 pb-4">
            <CardTitle className="text-xl">{isSignUp ? t("signupTitle") : t("loginTitle")}</CardTitle>
            <CardDescription>{isSignUp ? t("signupSubtitle") : t("loginSubtitle")}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {isSignUp && (
                <div className="space-y-2">
                  <Label htmlFor="fullName">{t("fullName")}</Label>
                  <Input
                    id="fullName"
                    type="text"
                    placeholder={t("fullNamePlaceholder")}
                    value={fullName}
                    onChange={(event) => setFullName(sanitizeUserFieldInput("fullName", event.target.value))}
                    autoComplete="name"
                    maxLength={120}
                    required
                  />
                  {(attemptedSubmit || fullName.trim().length > 0) && signupErrors.fullName && (
                    <p className="text-xs text-destructive">{signupErrors.fullName}</p>
                  )}
                </div>
              )}

              {isSignUp && (
                <div className="space-y-2">
                  <Label>Tipo de cadastro</Label>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <Button
                      type="button"
                      variant={signupMode === "company_owner" ? "default" : "outline"}
                      onClick={() => {
                        setSignupMode("company_owner");
                        setAttemptedSubmit(false);
                        setSelectedCompany(null);
                      }}
                    >
                      Conta empresa
                    </Button>
                    <Button
                      type="button"
                      variant={signupMode === "company_internal" ? "default" : "outline"}
                      onClick={() => {
                        setSignupMode("company_internal");
                        setAttemptedSubmit(false);
                        setSelectedCompany(null);
                      }}
                    >
                      Conta interna
                    </Button>
                  </div>
                  <div className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
                    <p className="font-medium text-foreground">Fluxos disponiveis</p>
                    <p>1. Criar empresa nova: use "Conta empresa".</p>
                    <p>2. Solicitar acesso: use "Conta interna" e selecione a empresa na lista.</p>
                    <p>3. Entrar por convite: acesse o link recebido por e-mail e conclua o cadastro.</p>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="email">{t("email")}</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder={t("corporateEmailPlaceholder")}
                  value={email}
                  onChange={(event) => setEmail(sanitizeUserFieldInput("email", event.target.value))}
                  autoComplete="email"
                  maxLength={254}
                  required
                />
                {(attemptedSubmit || email.trim().length > 0) && signupErrors.email && (
                  <p className="text-xs text-destructive">{signupErrors.email}</p>
                )}
              </div>

              {isSignUp && (
                <div className="space-y-2">
                  <Label htmlFor="companyName">Nome da empresa</Label>
                  <Input
                    id="companyName"
                    type="text"
                    placeholder="Nome oficial da empresa"
                    value={companyName}
                    onChange={(event) => {
                      const next = sanitizeUserFieldInput("companyName", event.target.value);
                      setCompanyName(next);
                      if (signupMode === "company_internal") {
                        setTenantId(null);
                        setSelectedCompany(null);
                      }
                    }}
                    autoComplete="organization"
                    maxLength={120}
                    required
                  />
                  {(attemptedSubmit || companyName.trim().length > 0) && signupErrors.companyName && (
                    <p className="text-xs text-destructive">{signupErrors.companyName}</p>
                  )}
                  {signupMode === "company_internal" && (
                    <div className="space-y-2">
                      {loadingCompanies && (
                        <p className="text-xs text-muted-foreground">Buscando empresas...</p>
                      )}
                      {!loadingCompanies && companySuggestions.length > 0 && (
                        <div className="max-h-40 overflow-y-auto rounded-md border border-border bg-card">
                          {companySuggestions.map((company) => (
                            <button
                              key={company.id}
                              type="button"
                              className="block w-full border-b border-border px-3 py-2 text-left text-sm last:border-b-0 hover:bg-accent"
                              onClick={() => {
                                setCompanyName(company.name);
                                setTenantId(company.tenant_id ?? company.id);
                                setSelectedCompany(company);
                                setCompanySuggestions([]);
                              }}
                            >
                              <span className="font-medium">{company.name}</span>
                              {company.slug ? <span className="ml-2 text-xs text-muted-foreground">({company.slug})</span> : null}
                              {typeof company.score === "number" ? (
                                <span className="ml-2 text-[10px] text-muted-foreground">
                                  score {Math.round(company.score * 100)}%
                                </span>
                              ) : null}
                            </button>
                          ))}
                        </div>
                      )}
                      {!loadingCompanies && companyName.trim().length >= 3 && companySuggestions.length === 0 && !tenantId && (
                        <p className="text-xs text-destructive">
                          Nenhuma empresa valida encontrada. Ajuste o nome e selecione na lista.
                        </p>
                      )}
                      {tenantId && (
                        <div className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                          <p className="font-medium">Empresa selecionada para solicitacao interna</p>
                          <p>
                            {selectedCompany?.name ?? companyName}
                            {selectedCompany?.slug ? ` (${selectedCompany.slug})` : ""}
                          </p>
                          <button
                            type="button"
                            className="mt-1 underline"
                            onClick={() => {
                              setTenantId(null);
                              setSelectedCompany(null);
                              setCompanySuggestions([]);
                            }}
                          >
                            Alterar empresa selecionada
                          </button>
                        </div>
                      )}
                      {attemptedSubmit && signupErrors.tenantId && (
                        <p className="text-xs text-destructive">{signupErrors.tenantId}</p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {isSignUp && (
                <div className="space-y-2">
                  <Label htmlFor="username">Usuario (nome exibido)</Label>
                  <Input
                    id="username"
                    type="text"
                    placeholder="Nome do usuario"
                    value={username}
                    onChange={(event) => setUsername(sanitizeUserFieldInput("username", event.target.value))}
                    autoComplete="nickname"
                    maxLength={50}
                    required
                  />
                  {(attemptedSubmit || username.trim().length > 0) && signupErrors.username && (
                    <p className="text-xs text-destructive">{signupErrors.username}</p>
                  )}
                </div>
              )}

              {isSignUp && (
                <div className="space-y-2">
                  <Label htmlFor="jobTitle">Cargo</Label>
                  <Input
                    id="jobTitle"
                    type="text"
                    placeholder="Ex.: Comprador, Engenheiro, Almoxarife"
                    value={jobTitle}
                    onChange={(event) => setJobTitle(sanitizeUserFieldInput("jobTitle", event.target.value))}
                    autoComplete="organization-title"
                    maxLength={80}
                    required
                  />
                  {(attemptedSubmit || jobTitle.trim().length > 0) && signupErrors.jobTitle && (
                    <p className="text-xs text-destructive">{signupErrors.jobTitle}</p>
                  )}
                </div>
              )}

              {isSignUp && (
                <div className="space-y-2">
                  <Label htmlFor="phone">Telefone (opcional)</Label>
                  <Input
                    id="phone"
                    type="tel"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    placeholder="Somente numeros (10 a 13)"
                    value={phone}
                    onChange={(event) => setPhone(sanitizeUserFieldInput("phone", event.target.value))}
                    maxLength={13}
                    autoComplete="tel"
                  />
                  {(attemptedSubmit || phone.length > 0) && signupErrors.phone && (
                    <p className="text-xs text-destructive">{signupErrors.phone}</p>
                  )}
                </div>
              )}

              {isSignUp && (
                <div className="space-y-2">
                  <Label htmlFor="requestedRole">Perfil de acesso</Label>
                  <select
                    id="requestedRole"
                    value={requestedRole}
                    onChange={(event) => setRequestedRole(event.target.value as AppRole)}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
                    disabled={signupMode === "company_owner"}
                  >
                    {roleOptions.map((role) => (
                      <option key={role.value} value={role.value}>
                        {role.label}
                      </option>
                    ))}
                  </select>
                  {signupMode === "company_owner" ? (
                    <p className="text-xs text-muted-foreground">
                      Conta empresa sempre nasce como Master.
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Se a empresa nao existir, o cadastro sera bloqueado e voce vera o aviso.
                    </p>
                  )}
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="password">{t("password")}</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="********"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete={isSignUp ? "new-password" : "current-password"}
                  required
                  minLength={6}
                />
              </div>

              <Button type="submit" className="w-full" disabled={loading || hasSignupErrors}>
                {loading ? (
                  <span className="flex items-center gap-2">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                    {t("loading")}
                  </span>
                ) : isSignUp ? (
                  <span className="flex items-center gap-2">
                    <UserPlus className="h-4 w-4" /> {t("createAccount")}
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <LogIn className="h-4 w-4" /> {t("signIn")}
                  </span>
                )}
              </Button>
            </form>

            <div className="mt-4 text-center">
              <button
                type="button"
                onClick={() => {
                  setIsSignUp((current) => !current);
                  setAttemptedSubmit(false);
                }}
                className="text-sm text-muted-foreground transition-colors hover:text-primary"
              >
                {isSignUp ? t("hasAccount") : t("noAccount")}
              </button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Login;

