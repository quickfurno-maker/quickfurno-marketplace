export type Rc4RequiredPrincipal = "owner" | "team_leader" | "staff";
export type Rc4StaffPrincipal = Readonly<{
  kind: Rc4RequiredPrincipal;
  userId: string;
  sessionId: string;
  staffRole?: string;
  teamId?: string;
  cityId?: string;
}>;
export type Rc4StaffResult =
  | Readonly<{ ok: false; code: string; status: number }>
  | Readonly<{ ok: true; principal: Rc4StaffPrincipal }>;
export type Rc4StaffDependencies = {
  verifyBearer: (token: string) => unknown | Promise<unknown>;
  loadFacts: (userId: string) => unknown | Promise<unknown>;
  isSessionLive: (userId: string, sessionId: string) => boolean | Promise<boolean>;
  now?: () => number;
};
export declare const RC4_STAFF_DENIALS: Readonly<Record<string, number>>;
export declare function parseBearer(header: string | null): string | null;
export declare function authorizeRc4Staff(input: {
  authorization: string | null;
  required: Rc4RequiredPrincipal;
  claimedUserId?: string;
  teamId?: string;
  cityId?: string;
  approval?: { requestedBy: string; targetUserId: string };
  deps: Rc4StaffDependencies;
}): Promise<Rc4StaffResult>;
