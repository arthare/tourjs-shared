import { RideMapPartial, MapBounds } from "./RideMap";
import { User, DEFAULT_HANDICAP_POWER } from "./User";
import { ServerMapDescription } from "./communication";
import { assert2 } from "./Utils";

export class RideMapHandicap extends RideMapPartial {
  _length:number;
  _mapDesc:ServerMapDescription;

  minDist:number;
  maxDist:number;
  minElev:number;
  maxElev:number;

  constructor(mapDesc:ServerMapDescription) {
    super();
    if(mapDesc.elevations.length <= 0 || mapDesc.distances.length <= 0) {
      throw new Error("Map description is bogus");
    }
    this._length = mapDesc.distances[mapDesc.distances.length-1];
    this._mapDesc = mapDesc;

    this.minDist = mapDesc.distances[0];
    this.maxDist = this._length;
    this.minElev = mapDesc.elevations[0];
    this.maxElev = mapDesc.elevations[0];
    mapDesc.elevations.forEach((elev) => {
      this.minElev = Math.min(elev, this.minElev);
      this.maxElev = Math.max(elev, this.maxElev);
    })

  }
  
  _indexBelowMeters(targetMeters:number):number {
    if(targetMeters <= this._mapDesc.distances[0]) {
      return 0;
    }
    if(targetMeters >= this._mapDesc.distances[this._mapDesc.distances.length-1]) {
      return this._mapDesc.distances.length - 1;
    }

    let ixLow = 0;
    let ixHigh = this._mapDesc.distances.length - 1;
    while(true) {
      const ixTest = Math.floor((ixLow + ixHigh) / 2);
      const meters = this._mapDesc.distances[ixTest];
      if(meters >= targetMeters) {
        ixHigh = ixTest;
      } else if(meters < targetMeters) {
        if(ixTest >= ixHigh-1) {
          return ixTest;
        }
        ixLow = ixTest;
      }
    }
  }

  getElevationAtDistance(meters: number): number {
    if(meters >= this.getLength()) {
      return this._mapDesc.elevations[this._mapDesc.elevations.length - 1];
    } else if(meters <= 0) {
      return this._mapDesc.elevations[0];
    }
    let ixLeft = this._indexBelowMeters(meters);
    let ixRight = ixLeft+1;

    let metersLeft = this._mapDesc.distances[ixLeft];
    let metersRight = this._mapDesc.distances[ixRight];
    assert2(metersRight > metersLeft);
    let offset = meters - metersLeft;
    let span = metersRight - metersLeft;
    let pct = offset / span;
    assert2(pct >= 0 && pct <= 1);

    let elevLeft = this._mapDesc.elevations[ixLeft];
    let elevRight = this._mapDesc.elevations[ixRight];
    return pct*elevRight + (1-pct)*elevLeft;
  }
  getPowerTransform(who: User): (power: number) => number {
    return (power:number) => {
      return DEFAULT_HANDICAP_POWER*(power / who.getHandicap());
    }
  }

  getLength():number {
    return this._length;
  }
  getBounds():MapBounds {
    return {
      minElev: this.minElev,
      maxElev: this.maxElev,
      minDist: this.minDist,
      maxDist: this.maxDist,
    }
  }
  
}