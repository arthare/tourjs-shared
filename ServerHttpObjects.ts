import { RideMapPartial, RideMapElevationOnly } from "./RideMap";
import { assert2 } from "./Utils";
import { getElevationFromEvenSpacedSamples } from "./communication";

export class ScheduleRacePostRequest {
  tmWhen:number;
  raceName:string;
  hostName:string;
  elevations: number[];
  lengthMeters: number;

  constructor(map:RideMapElevationOnly, when:Date, raceName:string, userName:string) {
    this.tmWhen = when.getTime();
    this.raceName = raceName;
    this.hostName = userName;
    
    this.elevations = [];
    for(var pct = 0; pct <= 1.0; pct += 0.005) {
      const len = pct * map.getLength();
      this.elevations.push(map.getElevationAtDistance(len));
    }
    this.lengthMeters = map.getLength();
  }
}

