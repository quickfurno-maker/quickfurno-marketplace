import { NextResponse } from "next/server";
export const dynamic="force-dynamic";
export function GET(){
 return NextResponse.json({service:"vox-web",status:"source-shell-only"},{headers:{"Cache-Control":"no-store"}});
}
