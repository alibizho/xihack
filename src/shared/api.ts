type ApiError = { code?: string; message?: string };
const errors: Record<string, string> = {
  AUTH_REQUIRED: "请先登录",
  AUTH_INVALID: "用户名或密码不正确",
  REGISTRATION_UNAVAILABLE: "注册暂不可用，请更换用户名或稍后重试",
  CSRF_INVALID: "登录已失效，请重新登录",
  ORIGIN_INVALID: "页面地址与服务器配置不一致",
  RATE_LIMITED: "请求过于频繁，请稍后重试",
  RUN_LIMIT_REACHED: "助理正忙，请稍后重试",
  INVALID_REQUEST: "输入不符合要求，请检查后重试",
};

export class ApiRequestError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, { ...init, credentials: "include" }).catch(() => {
    throw new ApiRequestError("NETWORK_ERROR", "无法连接服务器，请检查网络和后端服务");
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({})) as ApiError;
    throw new ApiRequestError(error.code || "HTTP_ERROR", errors[error.code || ""] || (response.status >= 500 ? "后端服务暂不可用，请稍后重试" : `请求失败 (${response.status})`));
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}

export function post<T>(path: string, body: object, csrf?: string): Promise<T> {
  return api<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(csrf ? { "X-CSRF-Token": csrf } : {}) },
    body: JSON.stringify(body),
  });
}
