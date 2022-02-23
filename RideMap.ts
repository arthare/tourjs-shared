import { User, UserInterface } from "./User";

export interface RideMapElevationOnly {
  getSlopeAtDistance(meters:number):number;
  getElevationAtDistance(meters:number):number;
  getLength():number;
}

export interface HillStats {
  startDist:number;
  endDist:number;
  startElev:number;
  endElev:number;
}

export abstract class RideMapPartial implements RideMapElevationOnly {

  constructor() {}
  getSlopeAtDistance(meters: number): number {
    const delta = 1;
    return (this.getElevationAtDistance(meters + delta) - this.getElevationAtDistance(meters - delta)) / (delta*2);
  }
  getHillStatsAtDistance(meters: number):HillStats|null {
    const slope = this.getSlopeAtDistance(meters);

    // let's figure out when this slope ends!
    const step = 10;
    const startPointMeters = step * Math.floor((meters+step) / step)
    const elevAtMeters = this.getElevationAtDistance(startPointMeters);
    let ret = {
      startDist: startPointMeters,
      endDist: startPointMeters,
      startElev: elevAtMeters,
      endElev: elevAtMeters,
    }

    // run backwards to find the start of the hill
    let lastElev = elevAtMeters;
    for(var checkMeters = startPointMeters - step; checkMeters >= 0; checkMeters -= step) {
      const elevAtCheck = this.getElevationAtDistance(checkMeters);
      const deltaSinceLast = elevAtCheck - lastElev;
      if(deltaSinceLast * slope <= 0) {
        // we're still going in the same direction, keeping in mind we're going backwards
        ret.startDist = checkMeters;
        ret.startElev = elevAtCheck;
      } else {
        break;
      }
      lastElev = elevAtCheck;
    }
    lastElev = elevAtMeters;
    for(var checkMeters = startPointMeters; checkMeters < this.getLength(); checkMeters += step) {
      const elevAtCheck = this.getElevationAtDistance(checkMeters);
      const deltaSinceLast = elevAtCheck - lastElev;
      if(deltaSinceLast * slope >= 0) {
        // ok, we're still going in the same direction
        ret.endDist = checkMeters;
        ret.endElev = elevAtCheck;
      } else {
        // stopped going in the same direction as slope
        break;
      }
      lastElev = elevAtCheck;
    }
    return ret.startDist !== ret.endDist ? ret : null;
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
    meters -= 200;
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