import Link from "next/link";
export function AarohiBadge({children,tone="neutral"}:{children:React.ReactNode;tone?:"neutral"|"good"|"warn"|"hot"|"muted"}){return <span className="qf-aarohi-badge" data-tone={tone}>{children}</span>}
export function AarohiMetric({label,value,helper}:{label:string;value:React.ReactNode;helper?:string}){return <div className="qf-aarohi-metric"><span>{label}</span><strong>{value}</strong>{helper?<small>{helper}</small>:null}</div>}
export function AarohiEmpty({title,message}:{title:string;message:string}){return <div className="qf-aarohi-empty"><strong>{title}</strong><p>{message}</p></div>}
export function AarohiPageHead({eyebrow="Aarohi Acquisition CRM",title,description,action}:{eyebrow?:string;title:string;description:string;action?:React.ReactNode}){return <header className="qf-aarohi-pagehead"><div><span>{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>{action}</header>}
export function ProspectLink({id,children}:{id:string;children:React.ReactNode}){return <Link className="qf-aarohi-business-link" href={`/admin/aarohi/prospects/${id}`}>{children}</Link>}
export function formatWhen(value:string|null|undefined){if(!value)return "—";const d=new Date(value);return Number.isNaN(d.getTime())?"—":new Intl.DateTimeFormat("en-IN",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"}).format(d)}
