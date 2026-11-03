// Narrow declarations for the pure Owner-only projection module.
export declare function projectOwnerAcquisition(input?: {
 prospects?: Record<string, unknown>[]; tasks?: Record<string, unknown>[];
}): Readonly<Record<string, unknown>>;
export declare function projectOwnerVendor360(input?: {
 vendors?: Record<string, unknown>[]; crm?: Record<string, unknown>[]; tasks?: Record<string, unknown>[];
}): Readonly<Record<string, unknown>>;
export declare function projectOwnerDesk(input?: {
 threads?: Record<string, unknown>[]; conversations?: Record<string, unknown>[]; now?: number;
}): Readonly<Record<string, unknown>>;
export declare function projectOwnerClientInbox(input?: {
 leads?: Record<string, unknown>[];
}): Readonly<Record<string, unknown>>;
