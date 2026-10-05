import CommonEmptyState from '../components/CommonEmptyState.vue';export default defineNuxtPlugin(app=>{app.vueApp.component('CommonEmptyState',CommonEmptyState)})
Object.assign(globalThis,{useAi:()=>({loading:ref(false),error:ref(null),rewrite:async()=>'',fixFormat:async()=>'',cancel:()=>{}})});
