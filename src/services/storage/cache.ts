import { openDB } from 'idb'
import type { EpgData } from '../../models/tv'
const DB='mon-guide-tv'; const STORE='epg'; const KEY='current'
const db=()=>openDB(DB,1,{upgrade(d){if(!d.objectStoreNames.contains(STORE))d.createObjectStore(STORE)}})
export async function readCache(){try{return await (await db()).get(STORE,KEY) as EpgData|undefined}catch{return undefined}}
export async function writeCache(data:EpgData){await (await db()).put(STORE,data,KEY)}
export async function clearCache(){await (await db()).delete(STORE,KEY)}
export const isFresh=(data:EpgData,ttl=86400000)=>Date.now()-new Date(data.fetchedAt).getTime()<ttl
