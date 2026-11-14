export function createSessionLifetime(onExpire:()=>void):{arm(seconds:number):void;clear():void;expired():boolean};
