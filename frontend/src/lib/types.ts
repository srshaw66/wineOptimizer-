export type Kind = 'vineyard' | 'block' | 'row' | 'plant';
export interface Feature { id:string;kind:Kind;name:string;parentId:string|null;blockId?:string;rowId?:string;plantNo?:number;center:[number,number];bounds?:[[number,number],[number,number]];line?:[[number,number],[number,number]];polygon?:Array<[number,number]>;status?:'normal'|'flagged' }
export interface Observation {id:string;plantId:string;date:string;coverage:number;status:string;note:string;photoUrl:string|null}
export type LayerKey='blocks'|'rows'|'plants'|'imagery';
export type PanelTab='Details'|'Data'|'History';
