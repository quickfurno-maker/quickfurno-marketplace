import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
 title:"VOX · QuickFurno Vendor Operations",
 description:"Internal staff-only QuickFurno Vendor Operations OS",
 robots:{index:false,follow:false}
};
export default function RootLayout({children}:{children:React.ReactNode}){
 return <html lang="en"><body>{children}</body></html>;
}
