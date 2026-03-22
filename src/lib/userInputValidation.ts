export const USER_FIELD_LIMITS = {
  fullName: { min: 2, max: 120 },
  companyName: { min: 2, max: 120 },
  username: { min: 3, max: 50 },
  jobTitle: { min: 2, max: 80 },
  email: { max: 254 },
  phone: { min: 10, max: 13 },
  password: { min: 6 },
} as const;

export type SignupMode = "company_owner" | "company_internal";

export type SignupValidationInput = {
  fullName: string;
  companyName: string;
  username: string;
  jobTitle: string;
  email: string;
  phone: string;
  password: string;
  signupMode: SignupMode;
  tenantId: string | null;
};

export type ProvisionValidationInput = {
  fullName: string;
  email: string;
  jobTitle: string;
  phone: string;
  password: string;
};

export type UserFormErrors = Partial<
  Record<
    | "fullName"
    | "companyName"
    | "username"
    | "jobTitle"
    | "email"
    | "phone"
    | "password"
    | "tenantId",
    string
  >
>;

const HAS_ALNUM_REGEX = /[\p{L}\p{N}]/u;
const HAS_LETTER_REGEX = /\p{L}/u;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const collapseWhitespace = (value: string) => value.replace(/\s+/g, " ").trimStart();
const trimAndCollapse = (value: string) => collapseWhitespace(value).trim();
const digitsOnly = (value: string, max: number) => value.replace(/\D+/g, "").slice(0, max);

const sanitizeByRegex = (value: string, regex: RegExp, max: number) =>
  collapseWhitespace(value)
    .replace(regex, "")
    .slice(0, max);

export const normalizeEmail = (value: string) =>
  value.replace(/\s+/g, "").toLowerCase().slice(0, USER_FIELD_LIMITS.email.max);

export const normalizePhone = (value: string) =>
  digitsOnly(value, USER_FIELD_LIMITS.phone.max);

export const sanitizeUserFieldInput = (
  field: "fullName" | "companyName" | "username" | "jobTitle" | "email" | "phone",
  value: string,
) => {
  switch (field) {
    case "fullName":
      return sanitizeByRegex(value, /[^\p{L}\s'-]/gu, USER_FIELD_LIMITS.fullName.max);
    case "companyName":
      return sanitizeByRegex(
        value,
        /[^\p{L}\p{N}\s.,&\-/()]/gu,
        USER_FIELD_LIMITS.companyName.max,
      );
    case "username":
      return sanitizeByRegex(value, /[^\p{L}\p{N}\s._-]/gu, USER_FIELD_LIMITS.username.max);
    case "jobTitle":
      return sanitizeByRegex(value, /[^\p{L}\p{N}\s._\-/()]/gu, USER_FIELD_LIMITS.jobTitle.max);
    case "email":
      return normalizeEmail(value);
    case "phone":
      return normalizePhone(value);
    default:
      return value;
  }
};

const validateHumanText = (
  value: string,
  min: number,
  max: number,
  {
    requireLetter,
    label,
  }: {
    requireLetter: boolean;
    label: string;
  },
) => {
  const normalized = trimAndCollapse(value);
  if (!normalized) return `${label} e obrigatorio.`;
  if (normalized.length < min) return `${label} deve ter ao menos ${min} caracteres.`;
  if (normalized.length > max) return `${label} deve ter no maximo ${max} caracteres.`;
  if (requireLetter && !HAS_LETTER_REGEX.test(normalized)) return `${label} deve conter letras.`;
  if (!requireLetter && !HAS_ALNUM_REGEX.test(normalized)) return `${label} nao pode conter apenas simbolos.`;
  return null;
};

const validateEmail = (value: string) => {
  const normalized = normalizeEmail(value).trim();
  if (!normalized) return "E-mail e obrigatorio.";
  if (normalized.length > USER_FIELD_LIMITS.email.max) {
    return `E-mail deve ter no maximo ${USER_FIELD_LIMITS.email.max} caracteres.`;
  }
  if (!EMAIL_REGEX.test(normalized)) return "Informe um e-mail valido.";
  return null;
};

const validatePhone = (value: string) => {
  const normalized = normalizePhone(value);
  if (!normalized) return null;
  if (normalized.length < USER_FIELD_LIMITS.phone.min || normalized.length > USER_FIELD_LIMITS.phone.max) {
    return `Telefone deve ter entre ${USER_FIELD_LIMITS.phone.min} e ${USER_FIELD_LIMITS.phone.max} numeros.`;
  }
  return null;
};

const validatePassword = (value: string) => {
  if (!value) return "Senha e obrigatoria.";
  if (value.length < USER_FIELD_LIMITS.password.min) {
    return `Senha deve ter ao menos ${USER_FIELD_LIMITS.password.min} caracteres.`;
  }
  return null;
};

export const validateSignupInput = (input: SignupValidationInput): UserFormErrors => {
  const errors: UserFormErrors = {};

  errors.fullName = validateHumanText(input.fullName, USER_FIELD_LIMITS.fullName.min, USER_FIELD_LIMITS.fullName.max, {
    requireLetter: true,
    label: "Nome completo",
  }) ?? undefined;
  errors.companyName = validateHumanText(
    input.companyName,
    USER_FIELD_LIMITS.companyName.min,
    USER_FIELD_LIMITS.companyName.max,
    {
      requireLetter: false,
      label: "Nome da empresa",
    },
  ) ?? undefined;
  errors.username = validateHumanText(input.username, USER_FIELD_LIMITS.username.min, USER_FIELD_LIMITS.username.max, {
    requireLetter: false,
    label: "Usuario",
  }) ?? undefined;
  errors.jobTitle = validateHumanText(input.jobTitle, USER_FIELD_LIMITS.jobTitle.min, USER_FIELD_LIMITS.jobTitle.max, {
    requireLetter: false,
    label: "Cargo",
  }) ?? undefined;
  errors.email = validateEmail(input.email) ?? undefined;
  errors.phone = validatePhone(input.phone) ?? undefined;
  errors.password = validatePassword(input.password) ?? undefined;

  if (input.signupMode === "company_internal" && !input.tenantId) {
    errors.tenantId = "Selecione uma empresa valida na lista antes de enviar.";
  }

  return errors;
};

export const validateProvisionInput = (input: ProvisionValidationInput): UserFormErrors => {
  const errors: UserFormErrors = {};

  errors.fullName = validateHumanText(input.fullName, USER_FIELD_LIMITS.fullName.min, USER_FIELD_LIMITS.fullName.max, {
    requireLetter: true,
    label: "Nome completo",
  }) ?? undefined;
  errors.email = validateEmail(input.email) ?? undefined;
  errors.jobTitle = validateHumanText(input.jobTitle, USER_FIELD_LIMITS.jobTitle.min, USER_FIELD_LIMITS.jobTitle.max, {
    requireLetter: false,
    label: "Cargo",
  }) ?? undefined;
  errors.phone = validatePhone(input.phone) ?? undefined;
  errors.password = validatePassword(input.password) ?? undefined;

  return errors;
};

export const hasValidationErrors = (errors: UserFormErrors) =>
  Object.values(errors).some(Boolean);
