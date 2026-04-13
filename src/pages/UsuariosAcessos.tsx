import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { PageShell } from "@/components/PageShell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth, type AppRole } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { roleLabelMap } from "@/lib/rbac";
import { getSupabaseFunctionErrorMessage } from "@/lib/supabaseFunctionError";
import {
  hasValidationErrors,
  normalizePhone,
  sanitizeUserFieldInput,
  validateProvisionInput,
} from "@/lib/userInputValidation";

type CompanyUserType = {
  id: string;
  name: string;
  description: string | null;
  base_role: AppRole;
  is_active: boolean;
};

type EditableUser = {
  user_id: string;
  tenant_id: string;
  full_name: string;
  email: string | null;
  is_active: boolean;
  user_type_id: string | null;
  access_mode: "template" | "custom";
  role: AppRole | null;
  obraIds: string[];
  grants: Array<{
    permission_key: string;
    scope_type: "tenant" | "all_obras" | "selected_obras";
    obraIds: string[];
  }>;
};

type PermissionCatalogItem = {
  key: string;
  area: string;
  label_pt: string;
  obra_scoped: boolean;
  is_active: boolean;
};

type TypePermissionScope = "tenant" | "all_obras";
type UserTypePermissionRow = {
  user_type_id: string;
  permission_key: string;
  scope_type: TypePermissionScope;
};

type TypeForm = {
  name: string;
  description: string;
  base_role: AppRole;
  is_active: boolean;
};

type ProvisionForm = {
  full_name: string;
  email: string;
  job_title: string;
  phone: string;
  role: AppRole;
  obra_ids: string[];
  temp_password: string;
};

type AuditEntry = {
  id: string;
  entity_table: string;
  action: string;
  changed_by: string | null;
  target_user_id: string | null;
  obra_id: string | null;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  created_at: string;
};

const defaultTypeForm: TypeForm = {
  name: "",
  description: "",
  base_role: "operacional",
  is_active: true,
};

const defaultProvisionForm: ProvisionForm = {
  full_name: "",
  email: "",
  job_title: "",
  phone: "",
  role: "operacional",
  obra_ids: [],
  temp_password: "",
};

const toComparableString = (value: unknown) => {
  if (value === null || value === undefined) return "-";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const buildAuditDiffRows = (entry: AuditEntry) => {
  const oldData = entry.old_data ?? {};
  const newData = entry.new_data ?? {};
  const keys = Array.from(new Set([...Object.keys(oldData), ...Object.keys(newData)])).sort();

  return keys
    .map((key) => {
      const before = toComparableString(oldData[key]);
      const after = toComparableString(newData[key]);
      if (before === after) return null;
      return { key, before, after };
    })
    .filter((item): item is { key: string; before: string; after: string } => item !== null);
};

const baseRoleOptions: Array<{ value: AppRole; label: string }> = [
  { value: "master", label: "Master" },
  { value: "gestor", label: "Gestor" },
  { value: "engenheiro", label: "Engenheiro" },
  { value: "operacional", label: "Operacional" },
  { value: "almoxarife", label: "Almoxarife" },
];

const auditEntityLabelMap: Record<string, string> = {
  profiles: "Perfil",
  user_roles: "Papel de acesso",
  user_obras: "Vinculo de obra",
  user_types: "Tipo de usuario",
};

const auditActionLabelMap: Record<string, string> = {
  insert: "Criacao",
  update: "Atualizacao",
  delete: "Remocao",
  admin_revert_access_change: "Reversao administrativa",
  master_recovery_hotfix: "Recuperacao master (hotfix)",
};

const toRoleString = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (["master", "gestor", "engenheiro", "operacional", "almoxarife"].includes(normalized)) {
    return normalized;
  }
  return null;
};

const getRoleFromAudit = (entry: AuditEntry) => {
  return toRoleString(entry.new_data?.role) ?? toRoleString(entry.old_data?.role);
};

const isSovereignAuditEvent = (entry: AuditEntry) => {
  const roleInSnapshot = getRoleFromAudit(entry);
  return entry.action.startsWith("master_") || roleInSnapshot === "master";
};

const isRevertEligibleAuditEvent = (entry: AuditEntry) => {
  if (!["user_roles", "user_obras", "profiles"].includes(entry.entity_table)) return false;
  return ["insert", "update", "delete"].includes(entry.action);
};

const formatAuditEntity = (value: string) => auditEntityLabelMap[value] ?? value;
const formatAuditAction = (value: string) => auditActionLabelMap[value] ?? value;

const TYPE_ROLE_PERMISSION_DEFAULTS: Record<AppRole, "ALL" | string[]> = {
  master: "ALL",
  gestor: [
    "users.manage",
    "audit.view",
    "obras.view",
    "obras.manage",
    "fornecedores.view",
    "fornecedores.manage",
    "materiais.view",
    "materiais.manage",
    "material_fornecedor.view",
    "material_fornecedor.manage",
    "pedidos.view",
    "pedidos.create",
    "pedidos.edit_base",
    "pedidos.approve",
    "pedidos.receive",
    "pedidos.delete",
    "estoque.view",
    "estoque.manage",
  ],
  operacional: [
    "obras.view",
    "fornecedores.view",
    "fornecedores.manage",
    "materiais.view",
    "materiais.manage",
    "material_fornecedor.view",
    "material_fornecedor.manage",
    "pedidos.view",
    "pedidos.create",
    "pedidos.edit_base",
  ],
  engenheiro: [
    "obras.view",
    "pedidos.view",
    "pedidos.approve",
    "estoque.view",
  ],
  almoxarife: [
    "obras.view",
    "pedidos.view",
    "pedidos.receive",
    "estoque.view",
    "estoque.manage",
  ],
};

const UsuariosAcessos = () => {
  const queryClient = useQueryClient();
  const { user, role, tenantId, refreshAccess } = useAuth();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabaseAny = supabase as any;

  const [drafts, setDrafts] = useState<Record<string, EditableUser>>({});
  const [typeDialogOpen, setTypeDialogOpen] = useState(false);
  const [editingType, setEditingType] = useState<CompanyUserType | null>(null);
  const [typeForm, setTypeForm] = useState<TypeForm>(defaultTypeForm);
  const [typePermissions, setTypePermissions] = useState<Record<string, TypePermissionScope>>({});
  const [provisionDialogOpen, setProvisionDialogOpen] = useState(false);
  const [provisionForm, setProvisionForm] = useState<ProvisionForm>(defaultProvisionForm);
  const [attemptedProvisionSubmit, setAttemptedProvisionSubmit] = useState(false);
  const [viewAsRole, setViewAsRole] = useState<AppRole | "none">("none");
  const [auditActorFilter, setAuditActorFilter] = useState<string>("all");
  const [auditTargetFilter, setAuditTargetFilter] = useState<string>("all");
  const [auditObraFilter, setAuditObraFilter] = useState<string>("all");
  const [auditStartDate, setAuditStartDate] = useState("");
  const [auditEndDate, setAuditEndDate] = useState("");
  const [selectedAuditId, setSelectedAuditId] = useState<string | null>(null);
  const provisionErrors = validateProvisionInput({
    fullName: provisionForm.full_name,
    email: provisionForm.email,
    jobTitle: provisionForm.job_title,
    phone: provisionForm.phone,
    password: provisionForm.temp_password,
  });
  const hasProvisionErrors = hasValidationErrors(provisionErrors);

  const { data: profiles = [], isLoading: loadingProfiles } = useQuery({
    queryKey: ["admin-users-profiles"],
    queryFn: async () => {
      const { data, error } = await supabaseAny
        .from("profiles")
        .select("id, user_id, tenant_id, full_name, email, is_active, user_type_id, access_mode")
        .order("full_name");
      if (error) throw error;
      return (data ?? []) as Array<{
        id: string;
        user_id: string;
        tenant_id: string;
        full_name: string;
        email: string | null;
        is_active: boolean;
        user_type_id: string | null;
        access_mode: "template" | "custom";
      }>;
    },
  });

  const { data: roles = [] } = useQuery({
    queryKey: ["admin-users-roles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("user_roles").select("id, user_id, role");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: userTypes = [] } = useQuery({
    queryKey: ["admin-user-types"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_types")
        .select("id, name, description, base_role, is_active")
        .order("name");
      if (error) throw error;
      return (data ?? []) as CompanyUserType[];
    },
  });

  const { data: assignments = [] } = useQuery({
    queryKey: ["admin-users-assignments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_obras")
        .select("id, user_id, obra_id");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: obras = [] } = useQuery({
    queryKey: ["admin-obras-for-assignment"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("obras")
        .select("id, name")
        .is("deleted_at", null)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: permissionCatalog = [] } = useQuery({
    queryKey: ["admin-permission-catalog"],
    queryFn: async () => {
      const { data, error } = await supabaseAny
        .from("permission_catalog")
        .select("key, area, label_pt, obra_scoped, is_active")
        .eq("is_active", true)
        .order("area")
        .order("key");
      if (error) throw error;
      return (data ?? []) as PermissionCatalogItem[];
    },
  });

  const { data: userTypePermissions = [] } = useQuery({
    queryKey: ["admin-user-type-permissions"],
    queryFn: async () => {
      const { data, error } = await supabaseAny
        .from("user_type_permissions")
        .select("user_type_id, permission_key, scope_type");
      if (error) throw error;
      return (data ?? []) as UserTypePermissionRow[];
    },
  });

  const { data: permissionGrants = [] } = useQuery({
    queryKey: ["admin-users-permission-grants"],
    queryFn: async () => {
      const { data: grantsData, error: grantsError } = await supabaseAny
        .from("user_permission_grants")
        .select("id, user_id, permission_key, scope_type");
      if (grantsError) throw grantsError;

      const grants = (grantsData ?? []) as Array<{
        id: string;
        user_id: string;
        permission_key: string;
        scope_type: "tenant" | "all_obras" | "selected_obras";
      }>;

      if (grants.length === 0) return [];

      const ids = grants.map((grant) => grant.id);
      const { data: grantObrasData, error: grantObrasError } = await supabaseAny
        .from("user_permission_obras")
        .select("grant_id, obra_id")
        .in("grant_id", ids);
      if (grantObrasError) throw grantObrasError;

      const grantObras = (grantObrasData ?? []) as Array<{ grant_id: string; obra_id: string }>;
      const obraIdsByGrant = grantObras.reduce<Record<string, string[]>>((acc, item) => {
        if (!acc[item.grant_id]) acc[item.grant_id] = [];
        acc[item.grant_id].push(item.obra_id);
        return acc;
      }, {});

      return grants.map((grant) => ({
        user_id: grant.user_id,
        permission_key: grant.permission_key,
        scope_type: grant.scope_type,
        obraIds: obraIdsByGrant[grant.id] ?? [],
      }));
    },
  });

  const { data: auditLog = [] } = useQuery({
    queryKey: ["admin-audit-log"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audit_log")
        .select("id, entity_table, action, changed_by, target_user_id, obra_id, old_data, new_data, created_at")
        .in("entity_table", ["user_roles", "user_obras", "profiles", "user_types"])
        .order("created_at", { ascending: false })
        .limit(120);
      if (error) throw error;
      return (data ?? []) as AuditEntry[];
    },
  });

  const roleByUserId = useMemo(() => {
    return roles.reduce<Record<string, AppRole>>((acc, item) => {
      acc[item.user_id] = item.role as AppRole;
      return acc;
    }, {});
  }, [roles]);

  const typeById = useMemo(() => {
    return userTypes.reduce<Record<string, CompanyUserType>>((acc, item) => {
      acc[item.id] = item;
      return acc;
    }, {});
  }, [userTypes]);

  const permissionCatalogByKey = useMemo(() => {
    return permissionCatalog.reduce<Record<string, PermissionCatalogItem>>((acc, item) => {
      acc[item.key] = item;
      return acc;
    }, {});
  }, [permissionCatalog]);

  const permissionCatalogByArea = useMemo(() => {
    return permissionCatalog.reduce<Record<string, PermissionCatalogItem[]>>((acc, item) => {
      if (!acc[item.area]) acc[item.area] = [];
      acc[item.area].push(item);
      return acc;
    }, {});
  }, [permissionCatalog]);

  const userTypePermissionsByTypeId = useMemo(() => {
    return userTypePermissions.reduce<Record<string, UserTypePermissionRow[]>>((acc, item) => {
      if (!acc[item.user_type_id]) acc[item.user_type_id] = [];
      acc[item.user_type_id].push(item);
      return acc;
    }, {});
  }, [userTypePermissions]);

  const buildDefaultTypePermissions = (baseRole: AppRole): Record<string, TypePermissionScope> => {
    const defaults = TYPE_ROLE_PERMISSION_DEFAULTS[baseRole];
    const allowedKeys =
      defaults === "ALL"
        ? new Set(permissionCatalog.map((item) => item.key))
        : new Set(defaults);

    return permissionCatalog.reduce<Record<string, TypePermissionScope>>((acc, permission) => {
      if (!allowedKeys.has(permission.key)) return acc;
      acc[permission.key] = permission.obra_scoped ? "all_obras" : "tenant";
      return acc;
    }, {});
  };

  const obraIdsByUserId = useMemo(() => {
    return assignments.reduce<Record<string, string[]>>((acc, item) => {
      if (!acc[item.user_id]) acc[item.user_id] = [];
      acc[item.user_id].push(item.obra_id);
      return acc;
    }, {});
  }, [assignments]);

  const actorObraIds = useMemo(
    () => (user?.id ? (obraIdsByUserId[user.id] ?? []) : []),
    [obraIdsByUserId, user?.id],
  );

  const grantsByUserId = useMemo(() => {
    return permissionGrants.reduce<
      Record<
        string,
        Array<{
          permission_key: string;
          scope_type: "tenant" | "all_obras" | "selected_obras";
          obraIds: string[];
        }>
      >
    >((acc, item) => {
      if (!acc[item.user_id]) acc[item.user_id] = [];
      acc[item.user_id].push({
        permission_key: item.permission_key,
        scope_type: item.scope_type,
        obraIds: item.obraIds,
      });
      return acc;
    }, {});
  }, [permissionGrants]);

  const nameByUserId = useMemo(() => {
    return profiles.reduce<Record<string, string>>((acc, profile) => {
      acc[profile.user_id] = profile.full_name || profile.email || profile.user_id;
      return acc;
    }, {});
  }, [profiles]);

  const obraNameById = useMemo(() => {
    return obras.reduce<Record<string, string>>((acc, obra) => {
      acc[obra.id] = obra.name;
      return acc;
    }, {});
  }, [obras]);

  const effectiveRole = viewAsRole === "none" ? role : viewAsRole;
  const isViewingAs = viewAsRole !== "none";

  const filteredAuditLog = useMemo(() => {
    const startDate = auditStartDate ? new Date(`${auditStartDate}T00:00:00`) : null;
    const endDate = auditEndDate ? new Date(`${auditEndDate}T23:59:59`) : null;

    return auditLog.filter((entry) => {
      if (auditActorFilter !== "all" && (entry.changed_by ?? "-") !== auditActorFilter) return false;
      if (auditTargetFilter !== "all" && (entry.target_user_id ?? "-") !== auditTargetFilter) return false;
      if (auditObraFilter !== "all" && (entry.obra_id ?? "-") !== auditObraFilter) return false;

      if (startDate || endDate) {
        const createdAt = new Date(entry.created_at);
        if (startDate && createdAt < startDate) return false;
        if (endDate && createdAt > endDate) return false;
      }

      return true;
    });
  }, [auditLog, auditActorFilter, auditTargetFilter, auditObraFilter, auditStartDate, auditEndDate]);

  const selectedAuditEntry = useMemo(
    () => filteredAuditLog.find((entry) => entry.id === selectedAuditId) ?? null,
    [filteredAuditLog, selectedAuditId],
  );

  const selectedAuditDiffRows = useMemo(
    () => (selectedAuditEntry ? buildAuditDiffRows(selectedAuditEntry) : []),
    [selectedAuditEntry],
  );

  const users = useMemo(() => {
    return profiles.map((profile) => {
      const fallback: EditableUser = {
        user_id: profile.user_id,
        tenant_id: profile.tenant_id,
        full_name: profile.full_name || "(sem nome)",
        email: profile.email,
        is_active: profile.is_active,
        user_type_id: profile.user_type_id,
        access_mode: (profile.access_mode ?? "template") as "template" | "custom",
        role: roleByUserId[profile.user_id] ?? null,
        obraIds: obraIdsByUserId[profile.user_id] ?? [],
        grants: grantsByUserId[profile.user_id] ?? [],
      };
      return drafts[profile.user_id] ?? fallback;
    });
  }, [profiles, drafts, roleByUserId, obraIdsByUserId, grantsByUserId]);

  const activeUsersCount = useMemo(
    () => users.filter((item) => item.is_active).length,
    [users],
  );

  const governanceHealth = useMemo(() => {
    const masters = users.filter((row) => {
      const selectedType = row.user_type_id ? typeById[row.user_type_id] : null;
      const effectiveRowRole = selectedType?.base_role ?? row.role;
      return effectiveRowRole === "master";
    });
    const activeMasters = masters.filter((row) => row.is_active);
    const mastersWithoutObra = masters.filter((row) => row.obraIds.length === 0);
    const delegatedAdminsInactive = users.filter((row) => {
      const selectedType = row.user_type_id ? typeById[row.user_type_id] : null;
      const effectiveRowRole = selectedType?.base_role ?? row.role;
      return (effectiveRowRole === "gestor" || effectiveRowRole === "engenheiro") && !row.is_active;
    });
    const delegatedAdminsWithoutObra = users.filter((row) => {
      const selectedType = row.user_type_id ? typeById[row.user_type_id] : null;
      const effectiveRowRole = selectedType?.base_role ?? row.role;
      return (effectiveRowRole === "gestor" || effectiveRowRole === "engenheiro") && row.obraIds.length === 0;
    });

    return {
      masters,
      activeMasters,
      mastersWithoutObra,
      delegatedAdminsInactive,
      delegatedAdminsWithoutObra,
      hasSingleActiveMaster: activeMasters.length === 1,
    };
  }, [users, typeById]);

  const isSmallCompany = useMemo(
    () => obras.length <= 2 || activeUsersCount <= 15,
    [obras.length, activeUsersCount],
  );

  const availableProvisionRoles = useMemo(() => {
    if (effectiveRole === "master") {
      return baseRoleOptions;
    }
    if (effectiveRole === "gestor") {
      return baseRoleOptions.filter((item) => item.value !== "master");
    }
    if (effectiveRole === "engenheiro") {
      return baseRoleOptions.filter((item) => item.value === "operacional" || item.value === "almoxarife");
    }
    return [];
  }, [effectiveRole]);

  const availableTypeBaseRoles = useMemo(() => {
    if (effectiveRole === "master") return baseRoleOptions;
    if (effectiveRole === "gestor") return baseRoleOptions.filter((item) => item.value !== "master");
    if (effectiveRole === "engenheiro") {
      return baseRoleOptions.filter((item) => item.value === "operacional" || item.value === "almoxarife");
    }
    return [];
  }, [effectiveRole]);

  const selectedAuditSovereign = selectedAuditEntry ? isSovereignAuditEvent(selectedAuditEntry) : false;
  const selectedAuditRevertEligible = selectedAuditEntry ? isRevertEligibleAuditEvent(selectedAuditEntry) : false;
  const selectedAuditRevertBlockedByRole = selectedAuditSovereign && effectiveRole !== "master";

  const provisionableObras = useMemo(() => {
    if (effectiveRole === "engenheiro") {
      const obraSet = new Set(actorObraIds);
      return obras.filter((obra) => obraSet.has(obra.id));
    }
    return obras;
  }, [actorObraIds, obras, effectiveRole]);

  const selectedTypePermissionCount = useMemo(
    () => Object.keys(typePermissions).length,
    [typePermissions],
  );

  const updateDraft = (userId: string, updater: (current: EditableUser) => EditableUser) => {
    setDrafts((current) => {
      const base = current[userId] ?? users.find((row) => row.user_id === userId);
      if (!base) return current;
      return {
        ...current,
        [userId]: updater(base),
      };
    });
  };

  const upsertGrant = (
    current: EditableUser,
    permissionKey: string,
    checked: boolean,
    obraScoped: boolean,
  ): EditableUser => {
    const hasGrant = current.grants.some((item) => item.permission_key === permissionKey);
    if (!checked && hasGrant) {
      return {
        ...current,
        grants: current.grants.filter((item) => item.permission_key !== permissionKey),
      };
    }
    if (!checked) return current;
    if (hasGrant) return current;

    return {
      ...current,
      grants: [
        ...current.grants,
        {
          permission_key: permissionKey,
          scope_type: obraScoped ? "all_obras" : "tenant",
          obraIds: [],
        },
      ],
    };
  };

  const saveUser = useMutation({
    mutationFn: async (payload: EditableUser) => {
      if (isViewingAs) {
        throw new Error("Desative o modo visualizar como perfil para salvar alteracoes.");
      }

      const { error: profileError } = await supabaseAny
        .from("profiles")
        .update({
          is_active: payload.is_active,
          user_type_id: payload.user_type_id,
          access_mode: payload.access_mode,
        })
        .eq("user_id", payload.user_id);
      if (profileError) throw profileError;

      const selectedType = payload.user_type_id ? typeById[payload.user_type_id] : null;
      const roleToPersist: AppRole | null = selectedType?.base_role ?? payload.role ?? null;
      if (roleToPersist && !availableTypeBaseRoles.some((item) => item.value === roleToPersist)) {
        throw new Error("Papel de acesso nao permitido para seu nivel.");
      }

      if (roleToPersist) {
        const { error: roleError } = await supabase
          .from("user_roles")
          .upsert({ user_id: payload.user_id, role: roleToPersist }, { onConflict: "user_id" });
        if (roleError) throw roleError;
      } else {
        const { error: roleDeleteError } = await supabase
          .from("user_roles")
          .delete()
          .eq("user_id", payload.user_id);
        if (roleDeleteError) throw roleDeleteError;
      }

      const currentObraIds = obraIdsByUserId[payload.user_id] ?? [];
      const toAdd = payload.obraIds.filter((obraId) => !currentObraIds.includes(obraId));
      const toRemove = currentObraIds.filter((obraId) => !payload.obraIds.includes(obraId));

      if (toRemove.length > 0) {
        const { error: removeError } = await supabase
          .from("user_obras")
          .delete()
          .eq("user_id", payload.user_id)
          .in("obra_id", toRemove);
        if (removeError) throw removeError;
      }

      if (toAdd.length > 0) {
        const rows = toAdd.map((obraId) => ({ user_id: payload.user_id, obra_id: obraId }));
        const { error: addError } = await supabase.from("user_obras").insert(rows);
        if (addError) throw addError;
      }

      const { data: existingGrantsData, error: existingGrantsError } = await supabaseAny
        .from("user_permission_grants")
        .select("id")
        .eq("user_id", payload.user_id);
      if (existingGrantsError) throw existingGrantsError;

      const existingGrantIds = ((existingGrantsData ?? []) as Array<{ id: string }>).map((item) => item.id);
      if (existingGrantIds.length > 0) {
        const { error: deleteGrantObrasError } = await supabaseAny
          .from("user_permission_obras")
          .delete()
          .in("grant_id", existingGrantIds);
        if (deleteGrantObrasError) throw deleteGrantObrasError;
      }

      const { error: deleteGrantsError } = await supabaseAny
        .from("user_permission_grants")
        .delete()
        .eq("user_id", payload.user_id);
      if (deleteGrantsError) throw deleteGrantsError;

      if (payload.access_mode === "custom" && payload.grants.length > 0) {
        for (const grant of payload.grants) {
          const { data: insertedGrant, error: insertGrantError } = await supabaseAny
            .from("user_permission_grants")
            .insert({
              tenant_id: payload.tenant_id,
              user_id: payload.user_id,
              permission_key: grant.permission_key,
              scope_type: grant.scope_type,
              granted_by: user?.id ?? null,
            })
            .select("id")
            .single();
          if (insertGrantError) throw insertGrantError;

          if (grant.scope_type === "selected_obras" && grant.obraIds.length > 0) {
            const rows = grant.obraIds.map((obraId) => ({
              grant_id: insertedGrant.id,
              obra_id: obraId,
            }));
            const { error: insertGrantObrasError } = await supabaseAny
              .from("user_permission_obras")
              .insert(rows);
            if (insertGrantObrasError) throw insertGrantObrasError;
          }
        }
      }
    },
    onSuccess: async (_result, payload) => {
      toast.success("Usuario atualizado");
      setDrafts((current) => {
        const next = { ...current };
        delete next[payload.user_id];
        return next;
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-users-profiles"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-users-roles"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-users-assignments"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-users-permission-grants"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-audit-log"] }),
      ]);

      if (user?.id === payload.user_id) {
        await refreshAccess();
      }
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const upsertUserType = useMutation({
    mutationFn: async (payload: TypeForm & { id?: string; permissions: Record<string, TypePermissionScope> }) => {
      if (isViewingAs) {
        throw new Error("Desative o modo visualizar como perfil para salvar tipos.");
      }

      if (!tenantId) {
        throw new Error("Tenant nao identificado para salvar tipo de usuario.");
      }

      const permissionPayload = Object.entries(payload.permissions).map(([permissionKey, scopeType]) => ({
        permission_key: permissionKey,
        scope_type: scopeType,
      }));

      const { error } = await supabaseAny.rpc("admin_upsert_user_type_with_permissions", {
        _tenant_id: tenantId,
        _name: payload.name.trim(),
        _description: payload.description.trim() || null,
        _base_role: payload.base_role,
        _is_active: payload.is_active,
        _permissions: permissionPayload,
        _id: payload.id ?? null,
      });

      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success(editingType ? "Tipo atualizado" : "Tipo criado");
      setTypeDialogOpen(false);
      setEditingType(null);
      setTypeForm(defaultTypeForm);
      setTypePermissions({});
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-user-types"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-user-type-permissions"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-users-profiles"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-users-roles"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-audit-log"] }),
      ]);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const provisionUser = useMutation({
    mutationFn: async (payload: ProvisionForm) => {
      if (isViewingAs) {
        throw new Error("Desative o modo visualizar como perfil para provisionar usuarios.");
      }

      if (!tenantId) {
        throw new Error("Tenant nao identificado para provisionamento.");
      }

      const normalizedRole = payload.role;
      if (!availableProvisionRoles.some((item) => item.value === normalizedRole)) {
        throw new Error("Perfil nao permitido para seu nivel de aprovacao.");
      }

      const body = {
        tenant_id: tenantId,
        email: payload.email.trim().toLowerCase(),
        full_name: payload.full_name.trim(),
        job_title: payload.job_title.trim(),
        phone: normalizePhone(payload.phone) || null,
        role: normalizedRole,
        obra_ids: payload.obra_ids,
        temp_password: payload.temp_password,
      };

      const { data, error } = await supabase.functions.invoke("admin-user-provision", { body });
      if (error || !data?.ok) {
        const functionMessage = await getSupabaseFunctionErrorMessage(error, data);
        if (String(data?.code ?? "").toLowerCase().includes("phone")) {
          throw new Error("Telefone invalido. Informe apenas numeros entre 10 e 13 digitos.");
        }
        throw new Error(functionMessage ?? data?.message ?? "Falha ao provisionar usuario.");
      }

      return data as { user_id: string; email: string };
    },
    onSuccess: async () => {
      toast.success("Usuario provisionado com senha temporaria.");
      setProvisionDialogOpen(false);
      setProvisionForm({
        ...defaultProvisionForm,
        role: availableProvisionRoles[0]?.value ?? "operacional",
      });
      setAttemptedProvisionSubmit(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-users-profiles"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-users-roles"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-users-assignments"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-audit-log"] }),
      ]);
    },
    onError: (error: Error) => {
      const message = String(error.message ?? "");
      const normalized = message.toLowerCase();
      if (normalized.includes("master nao pode alterar o proprio tipo de usuario")) {
        toast.error("Voce nao pode alterar o proprio tipo de usuario master.");
        return;
      }
      if (normalized.includes("conta master protegida")) {
        toast.error("Conta master protegida. O tipo de usuario nao pode ser alterado.");
        return;
      }
      toast.error(message);
    },
  });

  const revertAuditChange = useMutation({
    mutationFn: async (auditId: string) => {
      if (isViewingAs) {
        throw new Error("Desative o modo visualizar como perfil para reverter alteracoes.");
      }
      const { data, error } = await supabaseAny.rpc("admin_revert_access_change", {
        _audit_id: auditId,
      });
      if (error || !data?.ok) {
        throw new Error(error?.message ?? data?.message ?? "Falha ao reverter alteracao.");
      }
      return data as { ok: boolean };
    },
    onSuccess: async () => {
      toast.success("Alteracao revertida com sucesso.");
      setSelectedAuditId(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-users-profiles"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-users-roles"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-users-assignments"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-users-permission-grants"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-audit-log"] }),
      ]);
      await refreshAccess();
    },
    onError: (error: Error) => {
      const normalized = String(error.message ?? "").toLowerCase();
      if (normalized.includes("somente master pode reverter eventos soberanos")) {
        toast.error("Evento soberano: apenas master pode reverter.");
        return;
      }
      if (normalized.includes("entidade nao suportada para reversao")) {
        toast.error("Este evento nao e elegivel para reversao assistida.");
        return;
      }
      toast.error(error.message);
    },
  });

  const openCreateType = () => {
    const defaultBaseRole = availableTypeBaseRoles[0]?.value ?? "operacional";
    setEditingType(null);
    setTypeForm({
      ...defaultTypeForm,
      base_role: defaultBaseRole,
    });
    setTypePermissions(buildDefaultTypePermissions(defaultBaseRole));
    setTypeDialogOpen(true);
  };

  const openEditType = (type: CompanyUserType) => {
    const existingPermissions = (userTypePermissionsByTypeId[type.id] ?? []).reduce<
      Record<string, TypePermissionScope>
    >((acc, item) => {
      acc[item.permission_key] = item.scope_type;
      return acc;
    }, {});

    setEditingType(type);
    setTypeForm({
      name: type.name,
      description: type.description ?? "",
      base_role: type.base_role,
      is_active: type.is_active,
    });
    setTypePermissions(
      Object.keys(existingPermissions).length > 0
        ? existingPermissions
        : buildDefaultTypePermissions(type.base_role),
    );
    setTypeDialogOpen(true);
  };

  const saveType = () => {
    if (isViewingAs) {
      toast.error("Desative o modo visualizar como perfil para salvar tipos.");
      return;
    }

    if (!typeForm.name.trim()) {
      toast.error("Nome do tipo e obrigatorio");
      return;
    }
    if (!availableTypeBaseRoles.some((item) => item.value === typeForm.base_role)) {
      toast.error("Papel base nao permitido para seu nivel de acesso.");
      return;
    }
    if (selectedTypePermissionCount === 0) {
      toast.error("Selecione ao menos uma permissao para o tipo de usuario.");
      return;
    }

    upsertUserType.mutate({
      ...typeForm,
      permissions: typePermissions,
      ...(editingType ? { id: editingType.id } : {}),
    });
  };

  const openProvisionDialog = () => {
    if (!availableProvisionRoles.length) {
      toast.error("Seu perfil nao permite provisionar usuarios.");
      return;
    }

    setProvisionForm({
      ...defaultProvisionForm,
      role: availableProvisionRoles[0].value,
    });
    setAttemptedProvisionSubmit(false);
    setProvisionDialogOpen(true);
  };

  const saveProvision = () => {
    setAttemptedProvisionSubmit(true);
    if (hasProvisionErrors) {
      const firstError =
        provisionErrors.fullName ||
        provisionErrors.email ||
        provisionErrors.jobTitle ||
        provisionErrors.phone ||
        provisionErrors.password ||
        "Revise os campos obrigatorios.";
      toast.error(firstError);
      return;
    }

    provisionUser.mutate(provisionForm);
  };

  return (
    <PageShell title="Usuarios e Acessos">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Administracao de Usuarios</h2>
          <p className="text-sm text-muted-foreground">
            Usuario master gerencia usuarios, tipos da empresa e vinculos de obra.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {role === "master" && (
            <Select
              value={viewAsRole}
              onValueChange={(value) => setViewAsRole(value as AppRole | "none")}
            >
              <SelectTrigger className="w-[220px]">
                <SelectValue placeholder="Visualizar como perfil" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Visualizacao real (sem simulacao)</SelectItem>
                {baseRoleOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    Visualizar como {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {availableProvisionRoles.length > 0 && (
            <Button onClick={openProvisionDialog} disabled={isViewingAs}>
              <Plus className="mr-1 h-4 w-4" />
              Novo usuario
            </Button>
          )}
          <Badge variant="secondary">{users.length} usuarios</Badge>
        </div>
      </div>

      {isViewingAs && (
        <Alert className="mb-4">
          <AlertTitle>Modo visualizar como perfil ativo</AlertTitle>
          <AlertDescription>
            Simulacao de permissoes em sessao. Nenhuma troca de papel real e persistida enquanto este modo estiver ativo.
          </AlertDescription>
        </Alert>
      )}

      <div className="mb-6 grid gap-3 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Health check de governanca</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              Master ativo no tenant:{" "}
              <span className={governanceHealth.hasSingleActiveMaster ? "font-semibold text-emerald-700" : "font-semibold text-destructive"}>
                {governanceHealth.activeMasters.length}
              </span>
            </p>
            {!governanceHealth.hasSingleActiveMaster && (
              <p className="text-destructive">Esperado exatamente 1 master ativo por tenant.</p>
            )}
            <p>
              Masters sem obra vinculada:{" "}
              <span className={governanceHealth.mastersWithoutObra.length === 0 ? "font-semibold text-emerald-700" : "font-semibold text-destructive"}>
                {governanceHealth.mastersWithoutObra.length}
              </span>
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Semantica de papeis</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p><span className="font-medium text-foreground">Master:</span> soberano da empresa.</p>
            <p><span className="font-medium text-foreground">Gestor:</span> administrador delegado e revogavel.</p>
            <p><span className="font-medium text-foreground">Engenheiro:</span> aprovacao limitada ao nivel inferior.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Contas administrativas</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              Gestores/engenheiros inativos:{" "}
              <span className={governanceHealth.delegatedAdminsInactive.length === 0 ? "font-semibold text-emerald-700" : "font-semibold text-amber-700"}>
                {governanceHealth.delegatedAdminsInactive.length}
              </span>
            </p>
            <p>
              Gestores/engenheiros sem obra:{" "}
              <span className={governanceHealth.delegatedAdminsWithoutObra.length === 0 ? "font-semibold text-emerald-700" : "font-semibold text-amber-700"}>
                {governanceHealth.delegatedAdminsWithoutObra.length}
              </span>
            </p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="usuarios" className="space-y-6">
        <TabsList>
          <TabsTrigger value="usuarios">Usuarios</TabsTrigger>
          <TabsTrigger value="tipos">Tipos de Usuario</TabsTrigger>
        </TabsList>

        <TabsContent value="usuarios" className="space-y-4">
          {isSmallCompany && (
            <Alert>
              <AlertTitle>Template recomendado para empresa menor</AlertTitle>
              <AlertDescription>
                Detectamos ate 2 obras ativas ou ate 15 usuarios ativos. O fluxo recomendado e usar templates prontos e
                ajustar somente excecoes.
              </AlertDescription>
            </Alert>
          )}

          {loadingProfiles ? (
            <p className="text-muted-foreground">Carregando usuarios...</p>
          ) : (
            users.map((row) => {
              const selectedType = row.user_type_id ? typeById[row.user_type_id] : null;
              const effectiveRole = selectedType?.base_role ?? row.role;
              const isOwnMasterRow = role === "master" && row.user_id === user?.id;
              const isProtectedMasterRow = effectiveRole === "master";
              const disableTypeSelection = isOwnMasterRow || isProtectedMasterRow;
              const grantsByKey = row.grants.reduce<Record<string, EditableUser["grants"][number]>>((acc, item) => {
                acc[item.permission_key] = item;
                return acc;
              }, {});

              return (
                <Card key={row.user_id}>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">{row.full_name}</CardTitle>
                    <p className="text-xs text-muted-foreground">{row.email ?? row.user_id}</p>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-4">
                      <div className="space-y-2">
                        <Label>Ativo</Label>
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={row.is_active}
                            onCheckedChange={(checked) =>
                              updateDraft(row.user_id, (current) => ({ ...current, is_active: checked }))
                            }
                          />
                          <span className="text-sm text-muted-foreground">
                            {row.is_active ? "ativo" : "inativo"}
                          </span>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label>Tipo de usuario</Label>
                        <Select
                          value={row.user_type_id ?? "none"}
                          disabled={disableTypeSelection}
                          onValueChange={(value) =>
                            updateDraft(row.user_id, (current) => ({
                              ...current,
                              user_type_id: value === "none" ? null : value,
                            }))
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Sem tipo</SelectItem>
                            {userTypes.map((userType) => (
                              <SelectItem key={userType.id} value={userType.id}>
                                {userType.name} ({roleLabelMap[userType.base_role]})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {isOwnMasterRow && (
                          <p className="text-xs text-muted-foreground">
                            Voce nao pode alterar o proprio tipo de usuario master.
                          </p>
                        )}
                        {!isOwnMasterRow && isProtectedMasterRow && (
                          <p className="text-xs text-muted-foreground">
                            Conta master protegida: alteracao de tipo bloqueada.
                          </p>
                        )}
                      </div>

                      <div className="space-y-2">
                        <Label>Resumo</Label>
                        <p className="text-sm text-muted-foreground">
                          {effectiveRole ? roleLabelMap[effectiveRole] : "Sem papel"} - {row.obraIds.length} obra(s)
                        </p>
                      </div>

                      <div className="space-y-2">
                        <Label>Modo de acesso</Label>
                        <Select
                          value={row.access_mode}
                          onValueChange={(value) =>
                            updateDraft(row.user_id, (current) => ({
                              ...current,
                              access_mode: value as "template" | "custom",
                            }))
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="template">Template recomendado</SelectItem>
                            <SelectItem value="custom">Personalizado</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label>Obras vinculadas</Label>
                      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {obras.map((obra) => {
                          const checked = row.obraIds.includes(obra.id);
                          return (
                            <label
                              key={obra.id}
                              className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2"
                            >
                              <Checkbox
                                checked={checked}
                                onCheckedChange={(nextChecked) =>
                                  updateDraft(row.user_id, (current) => {
                                    const obraSet = new Set(current.obraIds);
                                    if (nextChecked) obraSet.add(obra.id);
                                    else obraSet.delete(obra.id);

                                    return {
                                      ...current,
                                      obraIds: Array.from(obraSet),
                                    };
                                  })
                                }
                              />
                              <span className="text-sm">{obra.name}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>

                    {row.access_mode === "custom" && (
                      <div className="space-y-3 rounded-md border border-border p-3">
                        <Label>Permissoes personalizadas</Label>
                        <div className="space-y-3">
                          {permissionCatalog.map((permission) => {
                            const grant = grantsByKey[permission.key];
                            const checked = !!grant;
                            return (
                              <div key={permission.key} className="rounded-md border border-border p-3">
                                <div className="flex flex-wrap items-center gap-3">
                                  <label className="flex items-center gap-2">
                                    <Checkbox
                                      checked={checked}
                                      onCheckedChange={(nextChecked) =>
                                        updateDraft(row.user_id, (current) =>
                                          upsertGrant(current, permission.key, Boolean(nextChecked), permission.obra_scoped),
                                        )
                                      }
                                    />
                                    <span className="text-sm font-medium">{permission.label_pt}</span>
                                  </label>
                                  <Badge variant="outline">{permission.area}</Badge>
                                </div>

                                {checked && grant && (
                                  <div className="mt-3 space-y-2">
                                    <Label>Escopo</Label>
                                    <Select
                                      value={grant.scope_type}
                                      onValueChange={(value) =>
                                        updateDraft(row.user_id, (current) => ({
                                          ...current,
                                          grants: current.grants.map((item) =>
                                            item.permission_key === permission.key
                                              ? {
                                                  ...item,
                                                  scope_type: value as "tenant" | "all_obras" | "selected_obras",
                                                  obraIds: value === "selected_obras" ? item.obraIds : [],
                                                }
                                              : item,
                                          ),
                                        }))
                                      }
                                    >
                                      <SelectTrigger className="max-w-xs">
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="tenant">Tenant inteiro</SelectItem>
                                        {permission.obra_scoped && <SelectItem value="all_obras">Todas as obras</SelectItem>}
                                        {permission.obra_scoped && <SelectItem value="selected_obras">Obras selecionadas</SelectItem>}
                                      </SelectContent>
                                    </Select>

                                    {grant.scope_type === "selected_obras" && (
                                      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                                        {obras.map((obra) => {
                                          const selected = grant.obraIds.includes(obra.id);
                                          return (
                                            <label
                                              key={`${permission.key}-${obra.id}`}
                                              className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2"
                                            >
                                              <Checkbox
                                                checked={selected}
                                                onCheckedChange={(nextChecked) =>
                                                  updateDraft(row.user_id, (current) => ({
                                                    ...current,
                                                    grants: current.grants.map((item) => {
                                                      if (item.permission_key !== permission.key) return item;
                                                      const obraSet = new Set(item.obraIds);
                                                      if (nextChecked) obraSet.add(obra.id);
                                                      else obraSet.delete(obra.id);
                                                      return { ...item, obraIds: Array.from(obraSet) };
                                                    }),
                                                  }))
                                                }
                                              />
                                              <span className="text-sm">{obra.name}</span>
                                            </label>
                                          );
                                        })}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    <div className="flex justify-end">
                      <Button onClick={() => saveUser.mutate(row)} disabled={saveUser.isPending || isViewingAs}>
                        Salvar
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}

          <div className="mt-8">
            <h3 className="mb-3 text-lg font-semibold">Log de alteracoes (acesso)</h3>
            <div className="mb-3 grid gap-2 md:grid-cols-5">
              <Select value={auditActorFilter} onValueChange={setAuditActorFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Autor" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os autores</SelectItem>
                  {Object.entries(nameByUserId).map(([userId, name]) => (
                    <SelectItem key={`audit-actor-${userId}`} value={userId}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={auditTargetFilter} onValueChange={setAuditTargetFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Alvo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os alvos</SelectItem>
                  {Object.entries(nameByUserId).map(([userId, name]) => (
                    <SelectItem key={`audit-target-${userId}`} value={userId}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={auditObraFilter} onValueChange={setAuditObraFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Obra" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as obras</SelectItem>
                  {obras.map((obra) => (
                    <SelectItem key={`audit-obra-${obra.id}`} value={obra.id}>
                      {obra.name}
                    </SelectItem>
                  ))}
                  <SelectItem value="-">Sem obra</SelectItem>
                </SelectContent>
              </Select>

              <Input
                type="date"
                value={auditStartDate}
                onChange={(event) => setAuditStartDate(event.target.value)}
                aria-label="Data inicial do log"
              />
              <Input
                type="date"
                value={auditEndDate}
                onChange={(event) => setAuditEndDate(event.target.value)}
                aria-label="Data final do log"
              />
            </div>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-4 py-3 text-left">Quando</th>
                    <th className="px-4 py-3 text-left">Entidade</th>
                    <th className="px-4 py-3 text-left">Acao</th>
                    <th className="px-4 py-3 text-left">Criticidade</th>
                    <th className="px-4 py-3 text-left">Obra</th>
                    <th className="px-4 py-3 text-left">Alvo</th>
                    <th className="px-4 py-3 text-left">Autor</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAuditLog.map((entry) => (
                    // Eventos soberanos recebem destaque para evitar reversoes indevidas.
                    <tr
                      key={entry.id}
                      className={`cursor-pointer border-t border-border hover:bg-muted/30 ${
                        isSovereignAuditEvent(entry) ? "bg-amber-50/50" : ""
                      }`}
                      onClick={() => setSelectedAuditId(entry.id)}
                    >
                      <td className="px-4 py-3">{new Date(entry.created_at).toLocaleString("pt-BR")}</td>
                      <td className="px-4 py-3">{formatAuditEntity(entry.entity_table)}</td>
                      <td className="px-4 py-3">{formatAuditAction(entry.action)}</td>
                      <td className="px-4 py-3">
                        {isSovereignAuditEvent(entry) ? (
                          <Badge variant="destructive">Soberano</Badge>
                        ) : (
                          <Badge variant="outline">Delegado</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {entry.obra_id ? (obraNameById[entry.obra_id] ?? entry.obra_id) : "-"}
                      </td>
                      <td className="px-4 py-3">
                        {nameByUserId[entry.target_user_id ?? ""] ?? entry.target_user_id ?? "-"}
                      </td>
                      <td className="px-4 py-3">
                        {nameByUserId[entry.changed_by ?? ""] ?? entry.changed_by ?? "-"}
                      </td>
                    </tr>
                  ))}
                  {filteredAuditLog.length === 0 && (
                    <tr>
                      <td className="px-4 py-3 text-muted-foreground" colSpan={7}>
                        Nenhuma alteracao registrada.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {selectedAuditEntry && (
              <div className="mt-4 rounded-lg border border-border p-4">
                <div className="mb-2 flex items-center justify-between">
                  <h4 className="text-sm font-semibold">Detalhe da alteracao</h4>
                  <Button variant="outline" size="sm" onClick={() => setSelectedAuditId(null)}>
                    Fechar
                  </Button>
                </div>
                <p className="mb-3 text-xs text-muted-foreground">
                  {new Date(selectedAuditEntry.created_at).toLocaleString("pt-BR")} - {formatAuditEntity(selectedAuditEntry.entity_table)} - {formatAuditAction(selectedAuditEntry.action)}
                </p>
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <Badge variant={selectedAuditSovereign ? "destructive" : "outline"}>
                    {selectedAuditSovereign ? "Evento soberano" : "Evento delegado"}
                  </Badge>
                  {!selectedAuditRevertEligible && (
                    <Badge variant="secondary">Sem reversao assistida</Badge>
                  )}
                  {selectedAuditRevertBlockedByRole && (
                    <Badge variant="secondary">Somente master pode reverter este evento</Badge>
                  )}
                </div>
                <div className="mb-3">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={
                      revertAuditChange.isPending ||
                      isViewingAs ||
                      !selectedAuditRevertEligible ||
                      selectedAuditRevertBlockedByRole
                    }
                    onClick={() => selectedAuditEntry && revertAuditChange.mutate(selectedAuditEntry.id)}
                  >
                    <RotateCcw className="mr-1 h-4 w-4" />
                    Reverter alteracao
                  </Button>
                </div>
                {selectedAuditDiffRows.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Nao houve mudanca de campos estruturados entre old_data e new_data.
                  </p>
                ) : (
                  <div className="overflow-x-auto rounded-md border border-border">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="px-3 py-2 text-left">Campo</th>
                          <th className="px-3 py-2 text-left">Valor anterior</th>
                          <th className="px-3 py-2 text-left">Valor novo</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedAuditDiffRows.map((diff) => (
                          <tr key={`${selectedAuditEntry.id}-${diff.key}`} className="border-t border-border">
                            <td className="px-3 py-2 font-medium">{diff.key}</td>
                            <td className="px-3 py-2">{diff.before}</td>
                            <td className="px-3 py-2">{diff.after}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="tipos" className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold">Tipos de Usuario da Empresa</h3>
              <p className="text-sm text-muted-foreground">
                Cada tipo define um papel base de permissao no sistema.
              </p>
            </div>
            <Button onClick={openCreateType}>
              <Plus className="mr-1 h-4 w-4" />
              Novo Tipo
            </Button>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {userTypes.map((userType) => {
              const permissionCount = userTypePermissionsByTypeId[userType.id]?.length ?? 0;
              return (
                <Card key={userType.id}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">{userType.name}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    <p className="text-muted-foreground">{userType.description || "Sem descricao"}</p>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">{roleLabelMap[userType.base_role]}</Badge>
                      <Badge variant={userType.is_active ? "default" : "outline"}>
                        {userType.is_active ? "ativo" : "inativo"}
                      </Badge>
                      <Badge variant="outline">{permissionCount} permissoes</Badge>
                    </div>
                    <div className="flex justify-end">
                      <Button variant="outline" size="sm" onClick={() => openEditType(userType)}>
                        <Pencil className="mr-1 h-4 w-4" />
                        Editar
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={typeDialogOpen} onOpenChange={setTypeDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingType ? "Editar Tipo de Usuario" : "Novo Tipo de Usuario"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Nome *</Label>
              <Input
                value={typeForm.name}
                onChange={(event) => setTypeForm((current) => ({ ...current, name: event.target.value }))}
                placeholder="Ex.: Supervisor de Compras"
              />
            </div>
            <div>
              <Label>Descricao</Label>
              <Input
                value={typeForm.description}
                onChange={(event) => setTypeForm((current) => ({ ...current, description: event.target.value }))}
                placeholder="Descricao resumida do tipo"
              />
            </div>
            <div>
              <Label>Papel base *</Label>
              <Select
                value={typeForm.base_role}
                disabled={availableTypeBaseRoles.length === 0}
                onValueChange={(value) => {
                  const nextBaseRole = value as AppRole;
                  setTypeForm((current) => ({ ...current, base_role: nextBaseRole }));
                  setTypePermissions(buildDefaultTypePermissions(nextBaseRole));
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {availableTypeBaseRoles.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {availableTypeBaseRoles.length === 0 && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Seu perfil nao permite criar tipos de usuario com papel base.
                </p>
              )}
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Permissoes do tipo *</Label>
                <Badge variant="secondary">{selectedTypePermissionCount} selecionadas</Badge>
              </div>
              <div className="max-h-72 space-y-3 overflow-y-auto rounded-md border border-border p-3">
                {Object.entries(permissionCatalogByArea).map(([area, permissions]) => (
                  <div key={area} className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{area}</p>
                    <div className="space-y-2">
                      {permissions.map((permission) => {
                        const checked = !!typePermissions[permission.key];
                        const selectedScope = typePermissions[permission.key] ?? "tenant";
                        return (
                          <div
                            key={permission.key}
                            className="rounded-md border border-border p-2"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <label className="flex items-center gap-2">
                                <Checkbox
                                  checked={checked}
                                  onCheckedChange={(nextChecked) =>
                                    setTypePermissions((current) => {
                                      const next = { ...current };
                                      if (!nextChecked) {
                                        delete next[permission.key];
                                        return next;
                                      }
                                      next[permission.key] = permission.obra_scoped ? "all_obras" : "tenant";
                                      return next;
                                    })
                                  }
                                />
                                <span className="text-sm">{permission.label_pt}</span>
                              </label>
                              {checked && permission.obra_scoped && (
                                <Select
                                  value={selectedScope}
                                  onValueChange={(value) =>
                                    setTypePermissions((current) => ({
                                      ...current,
                                      [permission.key]: value as TypePermissionScope,
                                    }))
                                  }
                                >
                                  <SelectTrigger className="h-8 w-[160px]">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="all_obras">Todas as obras</SelectItem>
                                    <SelectItem value="tenant">Tenant inteiro</SelectItem>
                                  </SelectContent>
                                </Select>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
                {permissionCatalog.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    Nenhuma permissao disponivel no catalogo.
                  </p>
                )}
              </div>
              {selectedTypePermissionCount === 0 && (
                <p className="text-xs text-destructive">Selecione ao menos uma permissao.</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={typeForm.is_active}
                onCheckedChange={(checked) => setTypeForm((current) => ({ ...current, is_active: checked }))}
              />
              <Label>Tipo ativo</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTypeDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={saveType} disabled={upsertUserType.isPending || isViewingAs}>
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={provisionDialogOpen}
        onOpenChange={(nextOpen) => {
          setProvisionDialogOpen(nextOpen);
          if (!nextOpen) setAttemptedProvisionSubmit(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo usuario (provisionamento administrativo)</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Nome completo *</Label>
              <Input
                value={provisionForm.full_name}
                onChange={(event) =>
                  setProvisionForm((current) => ({
                    ...current,
                    full_name: sanitizeUserFieldInput("fullName", event.target.value),
                  }))
                }
                placeholder="Nome completo"
                maxLength={120}
              />
              {(attemptedProvisionSubmit || provisionForm.full_name.trim().length > 0) && provisionErrors.fullName && (
                <p className="mt-1 text-xs text-destructive">{provisionErrors.fullName}</p>
              )}
            </div>
            <div>
              <Label>E-mail *</Label>
              <Input
                type="email"
                value={provisionForm.email}
                onChange={(event) =>
                  setProvisionForm((current) => ({
                    ...current,
                    email: sanitizeUserFieldInput("email", event.target.value),
                  }))
                }
                placeholder="usuario@empresa.com"
                maxLength={254}
              />
              {(attemptedProvisionSubmit || provisionForm.email.trim().length > 0) && provisionErrors.email && (
                <p className="mt-1 text-xs text-destructive">{provisionErrors.email}</p>
              )}
            </div>
            <div>
              <Label>Cargo *</Label>
              <Input
                value={provisionForm.job_title}
                onChange={(event) =>
                  setProvisionForm((current) => ({
                    ...current,
                    job_title: sanitizeUserFieldInput("jobTitle", event.target.value),
                  }))
                }
                placeholder="Ex.: Engenheiro de obra"
                maxLength={80}
              />
              {(attemptedProvisionSubmit || provisionForm.job_title.trim().length > 0) && provisionErrors.jobTitle && (
                <p className="mt-1 text-xs text-destructive">{provisionErrors.jobTitle}</p>
              )}
            </div>
            <div>
              <Label>Telefone (opcional)</Label>
              <Input
                type="tel"
                inputMode="numeric"
                pattern="[0-9]*"
                value={provisionForm.phone}
                onChange={(event) =>
                  setProvisionForm((current) => ({
                    ...current,
                    phone: sanitizeUserFieldInput("phone", event.target.value),
                  }))
                }
                placeholder="Somente numeros (10 a 13)"
                maxLength={13}
              />
              {(attemptedProvisionSubmit || provisionForm.phone.length > 0) && provisionErrors.phone && (
                <p className="mt-1 text-xs text-destructive">{provisionErrors.phone}</p>
              )}
            </div>
            <div>
              <Label>Perfil de acesso *</Label>
              <Select
                value={provisionForm.role}
                onValueChange={(value) =>
                  setProvisionForm((current) => ({ ...current, role: value as AppRole }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {availableProvisionRoles.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Obras vinculadas</Label>
              <div className="mt-2 grid max-h-40 gap-2 overflow-y-auto rounded-md border border-border p-2 sm:grid-cols-2">
                {provisionableObras.map((obra) => {
                  const selected = provisionForm.obra_ids.includes(obra.id);
                  return (
                    <label
                      key={`provision-obra-${obra.id}`}
                      className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2"
                    >
                      <Checkbox
                        checked={selected}
                        onCheckedChange={(nextChecked) =>
                          setProvisionForm((current) => {
                            const obraSet = new Set(current.obra_ids);
                            if (nextChecked) obraSet.add(obra.id);
                            else obraSet.delete(obra.id);
                            return { ...current, obra_ids: Array.from(obraSet) };
                          })
                        }
                      />
                      <span className="text-sm">{obra.name}</span>
                    </label>
                  );
                })}
                {provisionableObras.length === 0 && (
                  <p className="text-xs text-muted-foreground">Nenhuma obra disponivel para vinculo.</p>
                )}
              </div>
              {effectiveRole === "engenheiro" && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Como engenheiro, voce so pode provisionar usuarios nas obras em que ja esta vinculado.
                </p>
              )}
            </div>
            <div>
              <Label>Senha temporaria *</Label>
              <Input
                type="password"
                minLength={6}
                value={provisionForm.temp_password}
                onChange={(event) =>
                  setProvisionForm((current) => ({ ...current, temp_password: event.target.value }))
                }
                placeholder="Minimo 6 caracteres"
              />
              {(attemptedProvisionSubmit || provisionForm.temp_password.length > 0) && provisionErrors.password && (
                <p className="mt-1 text-xs text-destructive">{provisionErrors.password}</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setProvisionDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={saveProvision} disabled={provisionUser.isPending || hasProvisionErrors || isViewingAs}>
              Criar usuario
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
};

export default UsuariosAcessos;
