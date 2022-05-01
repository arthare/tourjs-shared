import { RideMap } from "./RideMap";
import { assert2, formatDisplayDistance } from "./Utils";
import { RaceState } from "./RaceState";
import { S2CPositionUpdateUser, S2CPositionUpdate, SERVER_UPDATE_RATE_HZ } from "./communication";


export interface CadenceRecipient {
  notifyCadence(tmNow:number, cadence:number):void;
}
export interface HrmRecipient {
  notifyHrm(tmNow:number, hrm:number):void;
  getLastHrm(tmNow:number):number;
}
export interface SlopeSource {
  getLastSlopeInWholePercent():number;
}


export const DEFAULT_CRR = 0.0033;
export const DEFAULT_GRAVITY = 9.81;
export const DEFAULT_RHO = 1.225;
export const DEFAULT_CDA = 0.25;
export const DEFAULT_HANDICAP_POWER = 300;
export const DEFAULT_RIDER_MASS = 80;
const UI_SMOOTH_SECONDS = 1.0;


export enum UserTypeFlags {
  Local = 1,
  Remote = 2,
  Ai = 4,
  Bot = 8,
}

export interface UserDisplay {
  rankString?: string;
  name: string;
  lastPower: string;
  distance: string;
  speed: string;
  slope: string;
  elevation: string;
  classString: string;
  lastWattsSaved: string;
  secondsDelta?:string;
  handicap:string;
  user:UserInterface;
  hrm: string;
}

class UserDataRecorder implements CadenceRecipient, HrmRecipient {
  private _lastPower:number = 0;
  private _tmLastPower:number = 0;
  private _id:number = -1; // assigned by the server.  Positive when set
  private _tmFinish:number = -1;
  private _tmLastPacket:number = -1;
  private _powerHistory:DistanceHistoryElement[] = [];

  private _lastHrm = 0;
  private _tmLastHrm = 0;

  isPowerValid(tmNow:number):boolean {
    return tmNow - this._tmLastPower < 5000;
  }

  public getPowerAverageForLastNSeconds(tmNow:number, seconds:number):number {
    let sum = 0;
    let count = 0;
    const tmFirst = tmNow - seconds*1000;
    
    for(var x = this._powerHistory.length - 1; x >= 0; x--) {
      if(this._powerHistory[x].tm < tmFirst) {
        // done adding!
        break;
      }

      sum += this._powerHistory[x].distance;
      count++;
    }
    return sum / count;
  }
  public notifyPower(tmNow:number, watts:number):void {
    this._lastPower = watts;
    this._tmLastPower = tmNow;
    this._powerHistory.push({tm:tmNow, distance:watts});
  }
  public notifyCadence(tmNow:number, cadence:number):void {

  }
  public notifyHrm(tmNow:number, hrm:number):void {
    this._tmLastHrm = tmNow;
    this._lastHrm = hrm;
  }

  public getLastHrm(tmNow:number):number {
    if(tmNow <= this._tmLastHrm + 5000) {
      return this._lastHrm;
    }
    return 0;
  }
  public getLastPower():number {
    return this._lastPower;
  }
  setFinishTime(tmNow:number) {
    this._tmFinish = tmNow;
  }
  getRaceTimeSeconds(tmRaceStart:number):number {
    return (this._tmFinish - tmRaceStart) / 1000.0;
  }
  isFinished():boolean {
    return this._tmFinish >= 0;
  }
  getMsSinceLastPacket(tmNow:number):number {
    return Math.max(0, tmNow - this._tmLastPacket);
  }
  public notePacket(tmNow:number) {
    this._tmLastPacket = tmNow;
  }

  setId(newId:number) {
    if(newId < 0) {
      assert2(this._id >= 0, "You're only allowed setting back to a negative id when you're disconnecting");
    } else if(newId >= 0) {
      assert2(this._id < 0, "You're only allowed setting positive IDs when you're connecting");
    }
    this._id = newId;
  }
  getId() {
    return this._id;
  }
}

export interface DraftSavings {
  watts:number;
  pctOfMax:number;
  fromDistance:number;
}
export interface DistanceHistoryElement {
  tm:number;
  distance:number;
}

export enum JoulesUsedClass {
  WholeCourse = 'whole-course',
  Last500m = 'last-500m',
  WhileUphill = 'while-uphill',
  WhileDownhill = 'while-downhill',
  FirstHalf = 'first-half',
  LastHalf = 'last-half',
}

export interface DrafteeStat {
  drafteeDist:number;
  drafteePctSaved:number;
}

export enum HandicapChangeReason {
  UserJoined,
  ServerRehandicap,
}
export interface UserInterface {
  getName(): string;
  getUserType(): number;
  getHandicap(): number;
  getHandicapSecondsSaved(): number;
  getHandicapSecondsUsed(): { [key: string]: number; };
  getId(): number;

  setId(newId: number): void;
  setHandicap(watts: number, changeReason:HandicapChangeReason): void;
  setChat(tmNow: number, chat: string): void;
  getLastChat(tmNow: number): { tmWhen: number; chat: string; } | null;
  getLastElevation(): number;
  getPositionUpdate(tmNow: number): S2CPositionUpdateUser;
  setDistance(dist: number): void;
  setSpeed(speed: number): void;
  setDistanceHistory(newHistory: DistanceHistoryElement[]): void;
  getDistanceHistory(): DistanceHistoryElement[];
  getLastSlopeInWholePercent(): number;
  getDistance(): number;
  getDistanceForUi(tmNow:number) : number;
  getSpeed(): number;
  getImage(): string | null;
  getBigImageMd5(): string | null;
  getLastHandicapChangeTime(): number;
  physicsTick(tmNow: number, map: RideMap, otherUsers: UserInterface[]): void;

  // drafting stuff
  notifyDrafteeThisCycle(tmNow: number, id: number, stat:DrafteeStat): void;
  getDrafteeStats():DrafteeStat[];
  getLastDraftLength():number; // how long (in meters) was your drafting wake last frame?
  hasDraftersThisCycle(tmNow: number): boolean;
  getDrafteeCount(tmNow: number): number;
  getLastWattsSaved(): DraftSavings; // how many watts did we save last round?
  isDraftingLocalUser(): boolean; // are we drafting the local player?

  getSecondsAgoToCross(tmNow: number, distance: number): number|null;
  getDisplay(raceState: RaceState | null): UserDisplay;
  setImage(imageBase64: string, bigImageMd5: string | null): void;
  absorbNameUpdate(tmNow: number, name: string, type: number, handicap: number): void;
  absorbPositionUpdate(tmNow: number, tmNowOnServer:number, update: S2CPositionUpdateUser): void;
  isPowerValid(tmNow: number): boolean;
  notifyPower(tmNow: number, watts: number): void;
  notifyCadence(tmNow: number, cadence: number): void;
  notifyHrm(tmNow: number, hrm: number): void;
  getLastHrm(tmNow: number): number;
  getLastPower(): number;
  setFinishTime(tmNow: number): void;
  getRaceTimeSeconds(tmRaceStart: number): number;
  isFinished(): boolean;
  getMsSinceLastPacket(tmNow: number): number;
  notePacket(tmNow: number): void;
}

function getDraftModForSpeed(speed:number):number {
  return Math.max(1, Math.min(2, speed / 10));
}
export class User extends UserDataRecorder implements SlopeSource, UserInterface {

  private _massKg: number;
  private _handicap: number;
  private _typeFlags:number;
  private _name:string;
  private _lastSlopeWholePercent:number = 0;
  private _imageBase64:string|null = null;
  private _bigImageMd5:string|null = null;

  private _lastT:number = 0;
  private _speed:number = 0;
  protected _position:number = 0;
  private _smoothDelta:number = 0;
  private _tmSmoothDelta:number = 0;
  private _lastDraftSaving:DraftSavings = {watts:0, pctOfMax:0, fromDistance:0};
  private _distanceHistory:DistanceHistoryElement[] = [];
  private _tmLastHandicapRevision:number = 0;
  private _bestDrafteeSavings:number = 0;

  private _pendingDraftees:{[key:string]:boolean} = {};
  private _lastDraftees:{[key:string]:boolean} = {};
  private _drafteeStats:DrafteeStat[] = [];
  private _tmDrafteeCycle:number = 0;
  private _lastElevation:number = 0;

  private _lastChat:string = '';
  private _lastChatTime:number = 0;
  private _physicsJoulesSaved:number = 0;
  private _physicsJoulesUsed:{[key:string]:number} = {};
  private _lastDraftUser:UserInterface|null = null;
  private _lastDraftLength:number = 0;

  constructor(name:string, massKg:number, handicap:number, typeFlags:number) {
    super();
    this._massKg = massKg;
    this._handicap = handicap;
    this._typeFlags = typeFlags;
    this._name = name;
    this._lastT = new Date().getTime() / 1000.0;
  }

  public setHandicap(watts:number, changeReason:HandicapChangeReason) {
    assert2(watts >= this._handicap || changeReason === HandicapChangeReason.UserJoined, "you should only increase handicaps, not tank them");
    this._handicap = watts;
  }

  setChat(tmNow:number, chat:string) {
    this._lastChat = chat;
    this._lastChatTime = tmNow;
  }
  getLastChat(tmNow:number):{tmWhen:number, chat:string}|null {

    const timeAgo = tmNow - this._lastChatTime;
    if(timeAgo > 10000) {
      return null;
    }

    return {
      tmWhen: this._lastChatTime,
      chat: this._lastChat,
    }
  }

  getLastElevation():number {
    return this._lastElevation;
  }
  getPositionUpdate(tmNow:number):S2CPositionUpdateUser {
    return {
      id:this.getId(),
      distance:this.getDistance(),
      speed:this.getSpeed(),
      power:this.getLastPower(),
      hrm:this.getLastHrm(tmNow),
    }
  }
  setDistance(dist:number) {
    this._position = dist;
  }
  setSpeed(speed:number) {
    this._speed = speed;
  }
  setDistanceHistory(newHistory:DistanceHistoryElement[]) {
    assert2(this._distanceHistory.length === 0); // this is intended to only be used if you're creating a "summary" user for the leaderboard
    this._distanceHistory = newHistory;
  }
  getDistanceHistory():DistanceHistoryElement[] {
    return this._distanceHistory;
  }

  getLastSlopeInWholePercent(): number {
    return this._lastSlopeWholePercent;
  }

  getDistance():number {
    return this._position;
  }
  getDistanceForUi(tmNow:number):number {
    const secondsSince = (tmNow - this._tmSmoothDelta) / 1000;
    const pct = Math.max(0, Math.min(1, secondsSince / UI_SMOOTH_SECONDS));
    const shiftAmt = this._smoothDelta * (1-pct);
    const ret = this._position - shiftAmt;

    return ret;
  }
  getSpeed():number {
    return this._speed;
  }

  getName():string {
    return this._name;
  }
  getImage():string|null {
    return this._imageBase64;
  }
  getBigImageMd5():string|null {
    return this._bigImageMd5;
  }

  getUserType():number {
    return this._typeFlags;
  }

  getHandicap() {
    return this._handicap;
  }
  getLastHandicapChangeTime():number {
    return this._tmLastHandicapRevision;
  }


  physicsTick(tmNow:number, map:RideMap, otherUsers:UserInterface[]) {


    const t = tmNow / 1000.0;
    const dtSeconds = t - this._lastT;
    this._lastT = t;
    if(dtSeconds < 0 || dtSeconds >= 1.0) {
      return;
    }

    // apply handicapping or other wackiness that the map might be applying
    const fnTransformPower = map.getPowerTransform(this);
    const transformedPower:number = fnTransformPower(this.getLastPower());

    const powerForce = transformedPower / Math.max(this._speed, 0.5);

    const rho = DEFAULT_RHO;
    const cda = DEFAULT_CDA;
    let aeroForce = -Math.pow(this._speed, 2) * 0.5 * rho * cda;


    if(this._position > 5) { // let's not engage drafting in the pre-start.

      this.drafteeCheck(tmNow);
      const draftingClose = 1.5;
      const draftingFar = 10;
      let effectiveDraftingFar = 10;
      let closestRider:UserInterface|null = null;
      let closestRiderDist:number = 1e30;
      let closestRiderEffectMod = 1;
      this._lastDraftLength = draftingFar*getDraftModForSpeed(this.getSpeed());

      otherUsers.forEach((user:UserInterface) => {
        const userAhead = user.getDistance() - this.getDistance();

        // user effect mod:
        // if they're going really fast, then their draft zone will extend up to twice as long at 72km/h.
        // BUT: the draft impact will be up-to-halved.
        const userEffectMod = getDraftModForSpeed(user.getSpeed())
        if(userAhead >= draftingClose*2 && userAhead <= draftingFar*userEffectMod) {
          if(!closestRider || userAhead < closestRiderDist) {
            closestRiderDist = userAhead;
            closestRider = user;
            closestRiderEffectMod = userEffectMod;
            effectiveDraftingFar = userEffectMod * draftingFar;
          }
        }
      });
      if(closestRider) {
        closestRider = <User>closestRider; // make typescript shut up
        // there was a draftable rider
        assert2(closestRiderDist >= draftingClose && closestRiderDist <= effectiveDraftingFar);
        // if there's 10 guys clustered behind a single rider, they're not going to get
        // as much benefit as a well-managed paceline
        const cRidersDraftingLastCycle = Math.max(1, closestRider.getDrafteeCount(tmNow));

        let bestPossibleReduction = (0.33 / cRidersDraftingLastCycle) / closestRiderEffectMod;
        const pctClose = 1 - bestPossibleReduction;
        const pctFar = 1.0;
        const myPct = (closestRiderDist - draftingClose) / (effectiveDraftingFar - draftingClose);

        closestRider.notifyDrafteeThisCycle(tmNow, this.getId(), {drafteeDist: this.getDistance(), drafteePctSaved: myPct});

        // myPct will be 1.0 when we're really far, 0.0 when we're really close
        let myPctReduction = myPct*pctFar + (1-myPct)*pctClose;



        const newtonsSaved = (1-myPctReduction)*aeroForce;
        aeroForce *= myPctReduction;

        const wattsSaved = Math.abs(newtonsSaved * this._speed);
        this._lastDraftUser = closestRider;
        this.setLastWattsSaved(dtSeconds, wattsSaved, 1-myPct, this.getDistance() + closestRiderDist);
      } else {
        this.setLastWattsSaved(dtSeconds,0, 0, this.getDistance());
        this._lastDraftUser = null;
      }
    }
    

    const slope = map.getSlopeAtDistance(this._position);
    this._lastSlopeWholePercent = slope*100;
    const theta = Math.atan(slope);

    const sinSquared = Math.sin(theta)*Math.sin(theta);
    const cosSquared = Math.pow(Math.cos(theta)-1,2);
    let slopeForce = -Math.sqrt(sinSquared+cosSquared)*this._massKg*DEFAULT_GRAVITY;
    if(slope < 0) {
      assert2(slopeForce <= 0);
      slopeForce = -slopeForce;
    }
    
    const rollingForce = -DEFAULT_CRR * this._massKg * DEFAULT_GRAVITY;

    assert2(rollingForce <= 0);
    assert2(aeroForce <= 0);
    
    const totalForce = powerForce + aeroForce + slopeForce + rollingForce;
    const accel = totalForce / this._massKg;

    this._speed = Math.max(0.5, this._speed  + accel * dtSeconds);
    assert2(this._speed >= 0);

    const lastPosition = this._position;
    const mapLength = map.getLength();
    this._position += Math.min(map.getLength(), this._speed * dtSeconds);
    this._position = Math.min(map.getLength(), this._position);
    this._lastElevation = map.getElevationAtDistance(this._position);

    const lastDistanceHistory = this._distanceHistory && this._distanceHistory[this._distanceHistory.length-1];
    if(!lastDistanceHistory || 
        this._position > lastDistanceHistory.distance && tmNow > lastDistanceHistory.tm + 1000) {
      this._distanceHistory.push({
        tm: tmNow,
        distance: this._position,
      });
    }

    if(lastPosition < mapLength && this._position >= mapLength) {
      this.setFinishTime(tmNow);
    }

    if(this._position > 0 && this._position < mapLength) {
      this._physicsJoulesUsed[JoulesUsedClass.WholeCourse] = (this._physicsJoulesUsed[JoulesUsedClass.WholeCourse] || 0) + dtSeconds * transformedPower;

      if(slope > 0) {
        this._physicsJoulesUsed[JoulesUsedClass.WhileUphill] = (this._physicsJoulesUsed[JoulesUsedClass.WhileUphill] || 0) + dtSeconds * transformedPower;
      }
      if(slope < 0) {
        this._physicsJoulesUsed[JoulesUsedClass.WhileDownhill] = (this._physicsJoulesUsed[JoulesUsedClass.WhileDownhill] || 0) + dtSeconds * transformedPower;
      }
      if(this._position >= map.getLength() - 500) {
        this._physicsJoulesUsed[JoulesUsedClass.Last500m] = (this._physicsJoulesUsed[JoulesUsedClass.Last500m] || 0) + dtSeconds * transformedPower;
      }
      if(this._position >= map.getLength() / 2) {
        this._physicsJoulesUsed[JoulesUsedClass.LastHalf] = (this._physicsJoulesUsed[JoulesUsedClass.LastHalf] || 0) + dtSeconds * transformedPower;
      }
      if(this._position < map.getLength() / 2) {
        this._physicsJoulesUsed[JoulesUsedClass.FirstHalf] = (this._physicsJoulesUsed[JoulesUsedClass.FirstHalf] || 0) + dtSeconds * transformedPower;
      }
    } else if(this._position <= 0) {
      // race not started yet
      this._physicsJoulesUsed[JoulesUsedClass.WholeCourse] = 0;
    }
  }

  public notifyDrafteeThisCycle(tmNow:number, id:number, pctSaved:DrafteeStat) {
    if(tmNow > this._tmDrafteeCycle) {
      // time for a new draftee cycle!
      this._lastDraftees = this._pendingDraftees;
      this._pendingDraftees = {};
      this._tmDrafteeCycle = tmNow;
      this._drafteeStats = [];
    }
    this._pendingDraftees[id] = true;
    this._drafteeStats.push(pctSaved);
  }
  public drafteeCheck(tmNow:number) {
    // this is here so that we don't eternally have this._lastDraftees holding onto the last guy that drafted us, since we never get another notifyDrafteeThisCycle if we go off the front and win
    if(tmNow > this._tmDrafteeCycle) {
      // time for a new draftee cycle!
      this._lastDraftees = this._pendingDraftees;
      this._pendingDraftees = {};
      this._tmDrafteeCycle = tmNow;
      this._bestDrafteeSavings = 0;
    }
  }
  public getDrafteeCount(tmNow:number):number {
    return Object.keys(this._lastDraftees).length;
  }
  public getDrafteeIds(tmNow:number):number[] {
    return Object.keys(this._lastDraftees).map((id) => parseInt(id));
  }

  public getSecondsAgoToCross(tmNow:number, distance:number):number|null {
    for(var x = 0;x < this._distanceHistory.length - 1; x++) {
      const hist = this._distanceHistory[x];
      const nextHist = this._distanceHistory[x+1];
      if(hist.distance < distance && nextHist.distance > distance) {
        // we found when we were near the queried spot
        const offset = distance - hist.distance;
        const span = nextHist.distance - hist.distance;
        const pct = offset / span;
        assert2(pct >= -0.001 && pct <= 1.001);
        const tmAtThatDist = pct*nextHist.tm + (1-pct)*hist.tm;
        if(tmAtThatDist < tmNow) {
          return (tmNow - tmAtThatDist) / 1000.0;
        }
      }
    }
    return null;
  }

  public isDraftingLocalUser():boolean {
    return !!(this._lastDraftUser && this._lastDraftUser.getUserType() & UserTypeFlags.Local);
  }
  public getDrafteeStats():DrafteeStat[] {
    return this._drafteeStats;
  }
  public getLastDraftLength(): number {
      return this._lastDraftLength;
  }
  public getLastWattsSaved():DraftSavings {
    return this._lastDraftSaving || {
      watts: 0,
      pctOfMax: 0,
      fromDistance: 0,
    };
  }
  private setLastWattsSaved(dt:number, watts:number, pctOfMax:number, fromDistance:number) {
    if(fromDistance > 5) { // don't count "savings" when everyone is in the starting corral
      this._physicsJoulesSaved += dt*watts;
      this._lastDraftSaving = {
        watts,
        pctOfMax,
        fromDistance,
      }
    }
  }

  public hasDraftersThisCycle(tmNow:number):boolean {
    return this.getDrafteeCount(tmNow) > 0;
  }

  public getHandicapSecondsSaved() {
    const handicapRatio = this._handicap / DEFAULT_HANDICAP_POWER;
    const userJoulesSaved = this._physicsJoulesSaved * handicapRatio;
    const handicapSecondsSaved = userJoulesSaved / this._handicap;
    return handicapSecondsSaved;
  }
  public getHandicapSecondsUsed():{[key:string]:number} {

    let ret:{[key:string]:number} = {};
    for(var key in this._physicsJoulesUsed) {
      ret[key] = this._physicsJoulesUsed[key] / DEFAULT_HANDICAP_POWER;
    }

    return ret;
  }

  getDisplay(raceState:RaceState|null):UserDisplay {
    const map = raceState && raceState.getMap() || null;
    let classes = [];
    if(this._typeFlags & UserTypeFlags.Local) {
      classes.push("local");
    }
    if(!(this._typeFlags & UserTypeFlags.Ai)) {
      classes.push("human");
    } else {
      classes.push("ai");
    }
    if(this._typeFlags & UserTypeFlags.Remote) {
      classes.push("remote");
    }

    const displayDist = map ? map.getLength() - this._position : this._position;
    const tmNow = new Date().getTime();
    return {
      name: this._name,
      lastPower: this.getLastPower().toFixed(0) + 'W',
      distance: formatDisplayDistance(displayDist),
      speed: (this._speed*3.6).toFixed(1) + 'km/h',
      slope: (map && (map.getSlopeAtDistance(this._position)*100).toFixed(1) + '%') || '',
      elevation: (map && map.getElevationAtDistance(this._position).toFixed(0) + 'm') || '',
      classString: classes.join(' '),
      lastWattsSaved: this.getLastWattsSaved().watts.toFixed(1) + 'W',
      handicap: this.getHandicap().toFixed(0) + 'W',
      user: this,
      hrm: this.getLastHrm(tmNow).toFixed(0) + "bpm",
    }
  }

  setImage(imageBase64:string, bigImageMd5:string|null) {
    assert2(imageBase64.startsWith('data:'));
    if(this.getUserType() & UserTypeFlags.Ai) {
      // I don't want to store images for hundreds of AI characters
      this._imageBase64 = null;
    } else {
      this._imageBase64 = imageBase64;
      this._bigImageMd5 = bigImageMd5;
    }
  }

  absorbNameUpdate(tmNow:number, name:string, type:number, handicap:number) {
    this._name = name;
    if(isFinite(handicap)) {
      if(handicap > this._handicap) {
        // remember the last time they bumped up our handicap - we'll put a notification in the UI
        // so someone can see if they got re-handicapped
        this._tmLastHandicapRevision = tmNow;
      }
      this._handicap = handicap;
    }
    if(!(this._typeFlags & UserTypeFlags.Local)) {
      this._typeFlags = type;
    }
  }
  absorbPositionUpdate(tmNow:number, tmNowOnServer:number, update:S2CPositionUpdateUser) {
    if(this._typeFlags & UserTypeFlags.Local) {
      // we're local, so we won't re-absorb the power from the server
    } else {
      // we're a remote or AI user, so we should try to be as similar to the server as possible
      this.notifyPower(tmNow, update.power);
      this.notifyHrm(tmNow, update.hrm);
    }

    // keep track of how far we had to move this user.  we can blend in this adjustment over the next couple frames so their client doesn't look all herky jerky
    const delta = update.distance - this.getDistanceForUi(tmNow); // how far off was our client estimate?
    
    this._smoothDelta = delta;
    this._tmSmoothDelta = tmNow;

    this._speed = update.speed;
    this._position = update.distance;

    
    this.notePacket(tmNow);
  }
}