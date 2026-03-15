type FunctionErrorLike = {
  message?: string;
  context?: Response;
};

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
};

const pickMessageFromPayload = (value: unknown): string | null => {
  const payload = asRecord(value);
  if (!payload) return null;

  const candidates = ["message", "error", "error_description", "msg"] as const;
  for (const key of candidates) {
    const current = payload[key];
    if (typeof current === "string" && current.trim()) {
      return current.trim();
    }
  }

  return null;
};

export const getSupabaseFunctionErrorMessage = async (
  error: unknown,
  data?: unknown,
): Promise<string | null> => {
  const messageFromData = pickMessageFromPayload(data);
  if (messageFromData) return messageFromData;

  const typedError = (error ?? null) as FunctionErrorLike | null;
  if (!typedError) return null;

  const context = typedError.context;
  if (context) {
    try {
      const payload = await context.clone().json();
      const messageFromContext = pickMessageFromPayload(payload);
      if (messageFromContext) return messageFromContext;
    } catch {
      // noop
    }

    try {
      const raw = (await context.clone().text()).trim();
      if (raw) return raw;
    } catch {
      // noop
    }
  }

  if (typedError.message?.trim()) {
    return typedError.message.trim();
  }

  return null;
};
