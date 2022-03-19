
export interface TourJsAlias {
  name:string;
  handicap:number;
  imageBase64:string;
  id:number;
}

export interface TourJsAccount {
  username?:string;
  sub:string;
  accountid:number;
  aliases: TourJsAlias[];
}