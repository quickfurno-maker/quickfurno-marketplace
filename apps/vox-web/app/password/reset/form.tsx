"use client";
import {useState} from "react";
export function PasswordResetForm(){
 const [message,setMessage]=useState("");
 const [busy,setBusy]=useState(false);
 async function submit(event:React.FormEvent<HTMLFormElement>){
  event.preventDefault();
  const form=new FormData(event.currentTarget);
  const value=form.get("password");
  const confirm=form.get("confirm");
  if(typeof value!=="string"||value.length<8||value!==confirm){
   setMessage("Passwords must match and meet the required length.");return;
  }
  setBusy(true);
  try{
   const response=await fetch("/api/auth/recovery/complete",{
    method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({password:value})
   });
   setMessage(response.ok?"Password updated. Please sign in again.":"Recovery request could not be completed.");
  }catch{setMessage("Recovery is currently unavailable.");}
  finally{setBusy(false);}
 }
 return <form onSubmit={submit} style={{display:"grid",gap:12}}>
  <label>New password<input type="password" name="password" required minLength={8} autoComplete="new-password"/></label>
  <label>Confirm password<input type="password" name="confirm" required minLength={8} autoComplete="new-password"/></label>
  <button type="submit" disabled={busy}>Update password</button>
  <p role="status">{message}</p>
 </form>;
}
