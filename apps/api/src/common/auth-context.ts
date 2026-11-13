import type { Permission, Role } from '@yangbenbu/shared';

/** 通過認證後附加在 request 上的身分資訊 */
export interface AuthContext {
  sessionId: string;
  staffId: string;
  staffName: string;
  clinicId: string;
  role: Role;
  permissions: ReadonlySet<Permission>;
  mfaEnabled: boolean;
}

/** 寫入稽核紀錄需要的請求資訊 */
export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}
