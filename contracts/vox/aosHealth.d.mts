export interface OwnerAosHealth {
 schema:"qf.vox.aos.health.v1";owner:"quickfurno-core";
 scope:"PLATFORM_OWNER_ONLY";source:"aosV2AdminService";
 mode:"READ_ONLY";observation:"READY"|"UNAVAILABLE";runtime:"SHADOW"|"OFF"|"UNKNOWN";
 advisoryOnly:true;actionsEnabled:false;intelligenceEnabled:boolean;proposalSwitchObserved:boolean;
 agentCount:number|null;operationalAgentCount:number|null;
 runs24h:number|null;completed24h:number|null;failed24h:number|null;recommendations24h:number|null;
 linkedSystems:Readonly<{jarvis:"NOT_VERIFIED";agni:"NOT_CONNECTED"}>;
}
export declare function projectOwnerAosHealth(snapshot:{
 runtime:{mode?:unknown;intelligenceEnabled?:unknown;actionProposalsEnabled?:unknown};
 persistenceReady?:unknown;counts:{totalAgents?:unknown;operationalAgents?:unknown;
 runs24h?:unknown;completed24h?:unknown;failed24h?:unknown;recommendations24h?:unknown;
 proposable24h?:unknown;};
}):OwnerAosHealth;
