import test from "node:test";
import assert from "node:assert/strict";
import {validateTimeCommand,validateRecordedIntervals,VO_TIME_SCHEMA}
 from "../../../contracts/vox/virtualOfficeTimekeeping.mjs";
import {validateMeetingIntent,googleMeetJoinLink}
 from "../../../contracts/vox/virtualOfficeMeeting.mjs";
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const t={action:"CLOCK_IN",nonce:id(1),expectedRevision:0};
test("VO-0: exact, original nonce and strictly bounded time commands",()=>{
 const ok=validateTimeCommand(t);
 assert.equal(ok.ok,true);assert.equal(ok.schema,VO_TIME_SCHEMA);
 assert.equal(ok.persisted,false);
 for(const action of ["CLOCK_IN","BREAK_START","BREAK_END","CLOCK_OUT"]){
  assert.equal(validateTimeCommand({...t,action}).ok,true);
 }
 for(const action of ["TASK_START","TASK_PAUSE","TASK_RESUME","TASK_STOP","TASK_SWITCH"]){
  assert.equal(validateTimeCommand({...t,action,workItemId:id(2)}).ok,true);
  assert.equal(validateTimeCommand({...t,action}).ok,false);
 }
});
test("VO-0: browser cannot provide time, Staff identity, duration, role or team",()=>{
 for(const bad of [{...t,serverTime:100},{...t,actorId:id(5)},
  {...t,teamId:id(7)},{...t,elapsedMs:120000},{...t,role:"owner"},
  {...t,nonce:"not uuid"},{...t,expectedRevision:2147483647},
  {...t,expectedRevision:-1},{...t,expectedRevision:0.5},{...t,foo:1},
  {...t,workItemId:id(2)},null,[],{},{
   action:"TASK_START",nonce:id(1),expectedRevision:1,workItemId:"wrong"
  }])assert.equal(validateTimeCommand(bad).ok,false,JSON.stringify(bad));
});
test("VO-0: verified ordered nonoverlapping server-time intervals",()=>{
 assert.equal(validateRecordedIntervals([{startMs:1000,endMs:3000},
  {startMs:3000,endMs:5000}]).totalMs,4000);
 assert.equal(validateRecordedIntervals([]).totalMs,0);
 for(const bad of [
  [{startMs:1000,endMs:3000},{startMs:2500,endMs:4000}],
  [{startMs:2000,endMs:1000}],
  [{startMs:0,endMs:1,duration:99}],
  [{startMs:1,endMs:2.5}],
  [{startMs:1,endMs:2},{startMs:0,endMs:1}],
  new Array(1001).fill({startMs:0,endMs:1})
 ])assert.equal(validateRecordedIntervals(bad).ok,false);
});
test("VO-0: provider-independent meeting intent never accepts a spoofed organizer",()=>{
 const m={title:"Weekly team sync",nonce:id(1),taskId:id(2),participantIds:[id(3),id(4)]};
 const ok=validateMeetingIntent(m);
 assert.equal(ok.ok,true);assert.equal(ok.providerCalled,false);
 assert.deepEqual([...ok.intent.participantIds],m.participantIds);
 for(const bad of [{...m,organizerId:id(99)},{...m,provider:"teams"},
  {...m,participantIds:[id(3),id(3)]},{...m,participantIds:[id(3),"wrong"]},
  {...m,title:" Secret \n title"},{...m,taskId:"bad"},{...m,nonce:"bad"}])
  assert.equal(validateMeetingIntent(bad).ok,false);
});
test("VO-0: only a canonical HTTPS Google Meet link may leave Core",()=>{
 const good=googleMeetJoinLink("https://meet.google.com/abc-defg-hij");
 assert.equal(good.ok,true);
 assert.equal(good.provider,"google_meet");
 for(const bad of ["http://meet.google.com/abc-defg-hij",
 "https://meet.google.com.evil.test/abc-defg-hij",
 "https://user:pass@meet.google.com/abc-defg-hij",
 "https://meet.google.com/abc-defg-hij?auth=token",
 "https://teams.microsoft.com/l/meetup-join/x",null])
  assert.equal(googleMeetJoinLink(bad).ok,false,String(bad));
});
test("VO-0: no operational provider calls, database writes or live credits",()=>{
 const source=[validateTimeCommand.toString(),validateRecordedIntervals.toString(),
  validateMeetingIntent.toString(),googleMeetJoinLink.toString()].join("\n");
 assert.doesNotMatch(source,/fetch\(|adminClient\(|\.rpc\(|createMeeting\(/);
});
