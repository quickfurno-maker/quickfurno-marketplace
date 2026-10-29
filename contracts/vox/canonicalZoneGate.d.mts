export interface VendorZoneRow {id:string;service_zone_id:string}
export interface ActiveCityZoneRow {id:string;city_id:string;is_active:boolean}
export declare function deriveCanonicalCityVendorIds(input:{
 cityId:string;
 grantedVendorIds:readonly string[];
 vendors:ReadonlyArray<VendorZoneRow>;
 zones:ReadonlyArray<ActiveCityZoneRow>;
}): {ok:true;ids:string[]} | {ok:false;error:string;ids:[]};
