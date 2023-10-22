import { start } from "repl";
import { DEFAULT_HANDICAP_POWER, DEFAULT_RIDER_MASS, User, UserInterface, UserTypeFlags } from "./User";
import { SimpleElevationMap } from "./communication";

export interface RideMapElevationOnly {
  getSlopeAtDistance(meters:number):number;
  getElevationAtDistance(meters:number):number;
  getLength():number;
  getHillStatsAtDistance(meters: number):HillStats|null;
}

export interface HillStats {
  startDist:number;
  endDist:number;
  startElev:number;
  endElev:number;
  id:number;
}

function calculateExpectedHillSeconds(stats:HillStats):number {
  // soo... given a start speed and an assumed handicap of handicap-watts, we need to calculate an expected # of seconds to ascent this hill.
  // we don't know what the start speed will be
  if(stats.endElev < stats.startElev) {
    return 0;
  }
  let startSpeed = 10;

  function calculateAscentTime(initialV:number):{time:number, endSpeed:number} {
    let tSeconds = 0;
    let user:User = new User("Test", DEFAULT_RIDER_MASS, DEFAULT_HANDICAP_POWER, UserTypeFlags.Local);
    user.setSpeed(initialV);
    let simpleMap = new SimpleElevationMap([stats.startElev, stats.endElev], stats.endDist - stats.startDist);
    while(user.getDistance() < simpleMap.getLength()) {
      user.notifyPower(tSeconds*1000, DEFAULT_HANDICAP_POWER);
      user.physicsTick(tSeconds, simpleMap, []);

      tSeconds += 1;
    }
    return {time:tSeconds / 1000, endSpeed:user.getSpeed()};
  }

  let lastAscentTime = -1e30;
  for(var x = 0;x < 50; x++) {
    let ascentTime = calculateAscentTime(startSpeed);
    if(Math.abs(ascentTime.time - lastAscentTime) <= 0.5) {
      // meh good enough
      return (ascentTime.time + lastAscentTime) / 2;
    }
    lastAscentTime = ascentTime.time;
    console.log("Took ", ascentTime, " s starting at speed ", startSpeed);
    startSpeed = ascentTime.endSpeed;
  }
}

let rideMapPartialCount = 0;

export abstract class RideMapPartial implements RideMapElevationOnly {

  ixNextMapId = 0;
  id;
  mapStatsCache:HillStats[] = [];

  constructor() {
    this.id = rideMapPartialCount++;
  }
  getSlopeAtDistance(meters: number): number {
    const delta = 1;
    return (this.getElevationAtDistance(meters + delta) - this.getElevationAtDistance(meters - delta)) / (delta*2);
  }
  getHillStatsAtDistance(meters: number):HillStats|null {

    // first, check the cache
    for(var stats of this.mapStatsCache) {
      if(stats.startDist <= meters && stats.endDist >= meters) {
        return JSON.parse(JSON.stringify(stats));
      }
    }
    this.ixNextMapId++;

    const slope = this.getSlopeAtDistance(meters);

    // let's figure out when this slope ends!
    const step = 10;
    const startPointMeters = step * Math.floor((meters+step) / step)
    const elevAtMeters = this.getElevationAtDistance(startPointMeters);

    let ret:HillStats = {
      startDist: startPointMeters,
      endDist: startPointMeters,
      startElev: elevAtMeters,
      endElev: elevAtMeters,
      id:this.ixNextMapId,
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

    console.log(this.id, "putting ret into cache ", ret);
    this.mapStatsCache.push(JSON.parse(JSON.stringify(ret)));
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
    meters -= -1900;
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