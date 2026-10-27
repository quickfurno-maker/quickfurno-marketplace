export declare function projectVoxOverview(input:{
prospects:readonly Record<string,unknown>[] |null;
crm:readonly Record<string,unknown>[] |null;
vendorSupport:readonly Record<string,unknown>[] |null;
humanConversations:readonly Record<string,unknown>[] |null;
}):{
schema:string;source:string;
prospectPreview:readonly unknown[];vendorCrmPreview:readonly unknown[];
supportPreview:readonly unknown[];humanDeskPreview:readonly unknown[];
permissions:readonly string[];actionsEnabled:boolean;
};
