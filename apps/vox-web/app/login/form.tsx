"use client";
import {useState} from "react";
export function LoginForm(){
 const [error,setError]=useState("");
 const [busy,setBusy]=useState(false);
 return <form onSubmit={async event=>{
  event.preventDefault();setError("");setBusy(true);
  const form=new FormData(event.currentTarget);
  try{
   const r=await fetch("/api/auth/sign-in",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email:form.get("email"),password:form.get("password")})});
   if(r.ok)window.location.assign("/mfa");else setError("Sign-in could not be verified.");
  }catch{setError("Sign-in unavailable.");}finally{setBusy(false);}
 }} style={{display:"grid",gap:12,textAlign:"left"}}>
  <label>Work email<input name="email" type="email" autoComplete="username" required maxLength={254}/></label>
  <label>Password<input name="password" type="password" autoComplete="current-password" required/></label>
  {error?<p role="alert">{error}</p>:null}
  <button disabled={busy} type="submit">{busy?"Checking…":"Sign in securely"}</button>
 </form>;
}
