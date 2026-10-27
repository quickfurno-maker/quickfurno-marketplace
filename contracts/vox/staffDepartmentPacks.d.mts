export type StaffDepartmentPackKey="client_success"|"vendor_success"|"acquisition"|"service_support";
export type StaffDepartmentPack=Readonly<{key:StaffDepartmentPackKey;label:string;sourceKinds:readonly string[]}>;
export declare const departmentPacks:ReadonlyArray<StaffDepartmentPack>;
export declare function prepareStaffCapabilityRequest(input?:Record<string,unknown>):Readonly<Record<string,unknown>>;
export declare function previewApprovedCapabilities(input?:Record<string,unknown>):Readonly<Record<string,unknown>>;
