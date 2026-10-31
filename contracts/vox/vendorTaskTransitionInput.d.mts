export interface VendorTaskTransitionScope {
  userId: string;
  cityId: string;
  role: string;
  vendorIds: readonly string[];
}
export type VendorTaskTransition = Readonly<{
  taskId: string;
  action: "complete" | "cancel";
  status: "done" | "cancelled";
  result: string | null;
}>;
export function normalizeVendorTaskTransition(
  input: unknown,
  scope: VendorTaskTransitionScope | null | undefined
): VendorTaskTransition | null;
