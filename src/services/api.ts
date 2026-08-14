import type { ApiResponse, UserProfile, UserPrefs, ApiKey } from "../types.js";

async function apiFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<ApiResponse<T>> {
  const res = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  let payload: ApiResponse<T> | null = null;
  try {
    payload = (await res.json()) as ApiResponse<T>;
  } catch {
    // A proxy/login page returning HTML must not masquerade as a valid API
    // response or surface as an opaque JSON parse exception.
  }
  if (!res.ok) {
    return {
      ok: false,
      error: payload?.error ?? `Request failed (HTTP ${res.status})`,
    };
  }
  if (!payload || typeof payload.ok !== "boolean") {
    return { ok: false, error: "Invalid server response" };
  }
  return payload;
}

export function fetchUser(): Promise<ApiResponse<UserProfile>> {
  return apiFetch<UserProfile>("/api/user");
}

export function fetchPrefs(): Promise<ApiResponse<UserPrefs>> {
  return apiFetch<UserPrefs>("/api/prefs");
}

export function updatePrefs(prefs: UserPrefs): Promise<ApiResponse<void>> {
  return apiFetch<void>("/api/prefs", {
    method: "PUT",
    body: JSON.stringify(prefs),
  });
}

export function createApiKey(
  name: string,
): Promise<ApiResponse<ApiKey & { key: string }>> {
  return apiFetch("/api/keys", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export function deleteApiKey(id: string): Promise<ApiResponse<void>> {
  return apiFetch<void>(`/api/keys/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export async function logout(): Promise<ApiResponse<void>> {
  const response = await apiFetch<void>("/auth/logout", { method: "POST" });
  if (response.ok) localStorage.removeItem("heavenward-has-session");
  return response;
}
