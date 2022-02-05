import { User, UserInterface } from "./User";

export interface RideMapElevationOnly {
  getSlopeAtDistance(meters:number):number;
  getElevationAtDistance(meters:number):number;
  getLength():number;
}
export abstract class RideMapPartial implements RideMapElevationOnly {

  getSlopeAtDistance(meters: number): number {
    const delta = 1;
    return (this.getElevationAtDistance(meters + delta) - this.getElevationAtDistance(meters - delta)) / (delta*2);
  }  
  abstract getElevationAtDistance(meters:number):number;
  abstract getLength():number;
}


export class IntoAHillMap extends RideMapPartial {
  _length:number;
  constructor(length:number) {
    super();
    this._length = length;
  }
  getElevationAtDistance(meters: number): number {
    if(meters < 50) {
      return Math.pow(meters, 2) / 2000;
    } else {
      return (meters - 50)*0.05 + 1.25;
    }
  }
  getLength(): number {
    return this._length;
  }
}

export class PureCosineMap extends RideMapPartial {
  _length:number;
  constructor(length:number) {
    super();
    this._length = length;
  }
  getElevationAtDistance(meters: number): number {
    return Math.sin(meters / 1000)*25 + 4*Math.cos(meters/97);
  }
  getLength(): number {
    return this._length;
  }
}

export interface MapBounds {
  minElev:number;
  maxElev:number;
  minDist:number;
  maxDist:number;
}

export interface RideMap extends RideMapPartial {
  getPowerTransform(who:UserInterface):(power:number)=>number;
  getBounds():MapBounds;
}