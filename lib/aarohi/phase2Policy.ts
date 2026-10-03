export const AAROHI_PHASE2_CHANNELS = ["INSTAGRAM","FACEBOOK","X","WHATSAPP"] as const;
export type AarohiPhase2Channel = typeof AAROHI_PHASE2_CHANNELS[number];

export type AarohiPhase2InitiationMode =
  | "ASSISTED_FIRST_CONTACT"
  | "GOVERNED_API_IF_ELIGIBLE"
  | "GOVERNED_TEMPLATE";

export interface AarohiPhase2ChannelPolicy {
  readonly channel:AarohiPhase2Channel;
  readonly initiation:AarohiPhase2InitiationMode;
  readonly coldStartAutomated:boolean;
  readonly continuationAutomated:boolean;
  readonly requiresCoreAuthorization:boolean;
  readonly arbitraryBrowserAutomation:false;
}

export const AAROHI_PHASE2_POLICY:Readonly<Record<AarohiPhase2Channel,AarohiPhase2ChannelPolicy>>=Object.freeze({
  INSTAGRAM:Object.freeze({
    channel:"INSTAGRAM",initiation:"ASSISTED_FIRST_CONTACT",
    coldStartAutomated:false,continuationAutomated:true,
    requiresCoreAuthorization:true,arbitraryBrowserAutomation:false,
  }),
  FACEBOOK:Object.freeze({
    channel:"FACEBOOK",initiation:"ASSISTED_FIRST_CONTACT",
    coldStartAutomated:false,continuationAutomated:true,
    requiresCoreAuthorization:true,arbitraryBrowserAutomation:false,
  }),
  X:Object.freeze({
    channel:"X",initiation:"GOVERNED_API_IF_ELIGIBLE",
    coldStartAutomated:true,continuationAutomated:true,
    requiresCoreAuthorization:true,arbitraryBrowserAutomation:false,
  }),
  WHATSAPP:Object.freeze({
    channel:"WHATSAPP",initiation:"GOVERNED_TEMPLATE",
    coldStartAutomated:false,continuationAutomated:true,
    requiresCoreAuthorization:true,arbitraryBrowserAutomation:false,
  }),
});

export const AAROHI_DISCOVERY_SOURCES = [
  "INSTAGRAM","FACEBOOK","X","GOOGLE","WEBSITE","JUSTDIAL","INDIAMART",
] as const;
export type AarohiDiscoverySource = typeof AAROHI_DISCOVERY_SOURCES[number];

export function initialOutreachState(channel:AarohiPhase2Channel):
  "NEEDS_HUMAN_REVIEW"|"NEEDS_CORE_AUTHORIZATION" {
  return AAROHI_PHASE2_POLICY[channel].initiation==="ASSISTED_FIRST_CONTACT"
    ?"NEEDS_HUMAN_REVIEW"
    :"NEEDS_CORE_AUTHORIZATION";
}

export function phase2ProviderExecutionEnabled():boolean {
  return process.env.QF_AAROHI_PHASE2_PROVIDER_EXECUTION_ENABLED?.trim().toLowerCase()==="true";
}

export function phase2AutonomousDiscoveryEnabled():boolean {
  return process.env.QF_AAROHI_PHASE2_DISCOVERY_ENABLED?.trim().toLowerCase()==="true";
}
