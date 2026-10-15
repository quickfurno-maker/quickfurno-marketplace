export interface NeutralVoxStaffProfile {
  id: string;
  role: string|null;
  is_active: boolean|null;
}
export interface VerifiedVoxAuthUser {
  id: string;
  app_metadata?: Record<string,unknown>|null;
}
export declare function isNeutralVoxStaffPrincipal(
  profile: NeutralVoxStaffProfile|null|undefined,
  verifiedUser: VerifiedVoxAuthUser|null|undefined
): boolean;
