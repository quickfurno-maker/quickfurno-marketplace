export const AAROHI_OMNICHANNEL_CHANNELS = ["INSTAGRAM","FACEBOOK","X","WHATSAPP","WEBSITE"] as const;
export type AarohiOmnichannelChannel = typeof AAROHI_OMNICHANNEL_CHANNELS[number];

export type AarohiChannelInitiationMode =
  | "ASSISTED_FIRST_CONTACT"
  | "GOVERNED_API_IF_ELIGIBLE"
  | "GOVERNED_TEMPLATE"
  | "INBOUND_ONLY";

export interface AarohiChannelPolicy {
  readonly channel:AarohiOmnichannelChannel;
  readonly discovery:boolean;
  readonly initiation:AarohiChannelInitiationMode;
  readonly automatedContinuation:boolean;
  readonly unifiedMemory:boolean;
  readonly arbitraryBrowserColdDm:boolean;
}

export const AAROHI_CHANNEL_POLICY:Readonly<Record<AarohiOmnichannelChannel,AarohiChannelPolicy>>=Object.freeze({
  INSTAGRAM:Object.freeze({
    channel:"INSTAGRAM",discovery:true,initiation:"ASSISTED_FIRST_CONTACT",
    automatedContinuation:true,unifiedMemory:true,arbitraryBrowserColdDm:false,
  }),
  FACEBOOK:Object.freeze({
    channel:"FACEBOOK",discovery:true,initiation:"ASSISTED_FIRST_CONTACT",
    automatedContinuation:true,unifiedMemory:true,arbitraryBrowserColdDm:false,
  }),
  X:Object.freeze({
    channel:"X",discovery:true,initiation:"GOVERNED_API_IF_ELIGIBLE",
    automatedContinuation:true,unifiedMemory:true,arbitraryBrowserColdDm:false,
  }),
  WHATSAPP:Object.freeze({
    channel:"WHATSAPP",discovery:false,initiation:"GOVERNED_TEMPLATE",
    automatedContinuation:true,unifiedMemory:true,arbitraryBrowserColdDm:false,
  }),
  WEBSITE:Object.freeze({
    channel:"WEBSITE",discovery:true,initiation:"INBOUND_ONLY",
    automatedContinuation:false,unifiedMemory:true,arbitraryBrowserColdDm:false,
  }),
});
