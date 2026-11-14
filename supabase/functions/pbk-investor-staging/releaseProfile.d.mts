export type PortalProfile = { environment:'live'|'staging'; functionName:string; table:string; stateId:string; commitRpc:string; bucket:string; publicOrigin:string; staffOrigin:string; extraOrigins:string[] };
export function portalProfile(environment:'live'|'staging'):PortalProfile;
export function seedLiveState(staging:Record<string,any>):Record<string,any>;
