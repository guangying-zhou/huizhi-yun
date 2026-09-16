export function useAppUrls(){return {resolveCurrentAppPath:(path:string)=>`/codocs${path}`,resolveCurrentAppUrl:(path:string)=>`${location.origin}/codocs${path}`}}
export function useViewerWatermark(){return {watermarkText:computed(()=> '王敏 1234')}}
export function usePageTitle(title:unknown){}
export function usePermissions(){return {hasPermission:()=>true}}
export function useAccountStore(){return {fetchUsersBatch:async()=>{},getUserByUid:(uid:string)=>({realName:'王敏',uid})}}

export function useAuth(){return {user:ref({uid:'U001',realName:'王敏'})}}

export function useAi(){return {loading:ref(false),error:ref(null),rewrite:async()=>'',fixFormat:async()=>'',cancel:()=>{}}}
