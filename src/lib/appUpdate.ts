export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "development";
export const UPDATE_QUERY = "_app_version";
const PASSWORD_KEY = "hansom-order-tool:update-password";
const PASSWORD_LIFETIME_MS = 60_000;
const validVersion = (value: unknown): value is string =>
  typeof value === "string" && /^[a-zA-Z0-9._-]{1,128}$/.test(value);

export async function fetchNewVersion(
  current: string,
  request: typeof fetch = fetch,
): Promise<string | null> {
  if (current === "development") return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await request(`/api/version?check=${Date.now()}`, {
      cache: "no-store",
      credentials: "omit",
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const payload: unknown = await response.json();
    if (
      typeof payload !== "object" ||
      payload === null ||
      !("version" in payload)
    )
      return null;
    return validVersion(payload.version) &&
      payload.version !== current &&
      payload.version !== "development"
      ? payload.version
      : null;
  } catch {
    // 일시적인 통신 오류 때문에 로컬 작업을 막지 않습니다.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// 업데이트할 때만 탭 안에 잠시 보관하고, 다음 로딩에서 즉시 삭제합니다.
export function keepPasswordForUpdate(
  storage: Storage,
  password: string,
  version: string,
  now = Date.now(),
) {
  try {
    storage.removeItem(PASSWORD_KEY);
    if (password && validVersion(version))
      storage.setItem(
        PASSWORD_KEY,
        JSON.stringify({
          password,
          version,
          expiresAt: now + PASSWORD_LIFETIME_MS,
        }),
      );
  } catch {
    /* 임시 저장이 차단된 환경에서는 다음 암호 파일에서 다시 입력합니다. */
  }
}

export function takePasswordAfterUpdate(
  storage: Storage,
  version: string,
  now = Date.now(),
): string {
  try {
    const saved = storage.getItem(PASSWORD_KEY);
    storage.removeItem(PASSWORD_KEY);
    if (!saved) return "";
    const data: unknown = JSON.parse(saved);
    if (
      typeof data !== "object" ||
      data === null ||
      !("password" in data) ||
      !("version" in data) ||
      !("expiresAt" in data)
    )
      return "";
    return data.version === version &&
      typeof data.password === "string" &&
      typeof data.expiresAt === "number" &&
      data.expiresAt > now &&
      data.expiresAt <= now + PASSWORD_LIFETIME_MS
      ? data.password
      : "";
  } catch {
    return "";
  }
}

export function updatePageUrl(currentUrl: string, version: string): string {
  if (!validVersion(version))
    throw new Error("업데이트 버전을 확인하지 못했어요.");
  const url = new URL(currentUrl);
  url.searchParams.set(UPDATE_QUERY, version);
  return url.href;
}
