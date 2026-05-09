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
  return res.json() as Promise<ApiResponse<T>>;
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

export function logout(): Promise<ApiResponse<void>> {
  return apiFetch<void>("/auth/logout", { method: "POST" });
}
