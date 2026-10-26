import Link from "next/link";
import {fetchTeamChat} from "../../../lib/teamWorkflow";
import ChatComposer from "./ChatComposer";
import "../workflow.css";
export const dynamic="force-dynamic";
export default async function StaffTeamChat(){
 const r=await fetchTeamChat();
 return <main className="voxFlow">
  <nav className="voxFlowNav" aria-label="Breadcrumb">
   <Link href="/team">Team Operations</Link><span aria-hidden="true">/</span><span>Internal Chat</span>
  </nav>
  <header className="voxFlowHero">
   <span className="voxFlowEyebrow">Verified current Core team · internal only</span>
   <h1>Team Chat</h1>
   <p>Team-scoped Staff messages stored in Core. No customer, vendor or agent
    conversations, WhatsApp, push notifications, or automatic actions.</p>
   <span className="voxFlowStatus">Restricted · staff AAL2</span>
  </header>
  {!r.ok?<section className="voxFlowCard" role="status">
   <h2>Internal chat is locked</h2>
   <p className="voxFlowMuted">{r.status===401?"Sign in with verified Staff MFA.":
    r.status===403?"Your Core Staff scope does not allow this conversation.":
    "Protected Staging Staff chat has not been independently activated."}</p>
   <Link href="/team">Return to Team Operations</Link>
  </section>:<>
   <section className="voxFlowCard" aria-labelledby="newTeamMessage">
    <h2 id="newTeamMessage">New internal message</h2>
    <ChatComposer/>
   </section>
   <section className="voxFlowCard" aria-labelledby="recentTeamMessages">
    <h2 id="recentTeamMessages">Recent team messages</h2>
    <p className="voxFlowMuted">A bounded preview of up to 25 messages,
     not a complete history or unread count.</p>
    {r.messages.length===0?<p role="status">No team messages in this verified window.</p>:
     <ul className="voxFlowList">{r.messages.map(m=>
      <li className="voxFlowRow" key={m.messageId}>
       <div><span>{m.isMine?"You":m.staffRef}</span><p>{m.body}</p></div>
       <time dateTime={m.createdAt}>{m.createdAt.slice(0,16)} UTC</time>
      </li>)}</ul>}
   </section>
  </>}
 </main>;
}
