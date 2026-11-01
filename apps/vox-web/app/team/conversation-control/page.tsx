import Link from "next/link";
import ConversationControl from "./ConversationControl";
import "../work-queue/queue.css";
export const dynamic="force-dynamic";
export default function ConversationControlPage(){
 const enabled=process.env.VOX_STAFF_PORTAL_ENABLED==="staging"&&
  process.env.VOX_TEAM_WORKSPACE_ENABLED==="staging"&&
  process.env.VOX_STAFF_GRANTS_ENABLED==="staging"&&
  process.env.VOX_RC42_CORE_CONVERSATION_OPERATOR_ENABLED==="staging"&&
  ["scoped","dual"].includes(String(process.env.VOX_STAFF_VIEW_MODE));
 return <main className="voxQueueRoot">
  <nav className="voxQueueNav"><Link href="/team">Team Operations</Link>
   <span aria-hidden="true">/</span><span>Conversation control</span></nav>
  <header className="voxQueueHero">
   <p className="voxQueueEyebrow">NATIVE CORE AUTHORITY / NO PROVIDER SEND</p>
   <h1>Conversation control</h1>
   <p>Pause AI or transfer an authorized, currently assigned conversation to a
    human. Core rechecks Staff MFA, department, item grant, consent and revision
    inside one atomic transaction. No WhatsApp message is sent.</p>
  </header>
  <section className="voxQueueCard">
   {!enabled?<p role="status">Atomic conversation control is not approved for
    this environment. No changes can be made.</p>:<ConversationControl/>}
  </section>
 </main>;
}
