import { RideMap } from "./RideMap";
import { User, UserInterface, UserTypeFlags } from "./User";
import { assert2 } from "./Utils";
import { S2CPositionUpdate, S2CNameUpdate } from "./communication";


// why UserProvider?  this lets us have a network-connected module that figures out all the users that are currently
// in existence.
export interface UserProvider {
  getUsers(tmNow:number):UserInterface[];
  getUser(id:number):UserInterface|null;
  getLocalUser():UserInterface|null;
}

export function getAIStrengthBoostForDistance(dist:number):number {
  
  const expectedTimeHours = dist / 40000;
  const aiStrengthBoost = 0.89 * Math.pow(expectedTimeHours, -0.155831);
  return aiStrengthBoost;
}

export class RaceState {
  private _map:RideMap;
  private _userProvider:UserProvider;
  private _gameId:string;
  private _tmUnfinishedHuman:number = 0;
  private _stopped:boolean = false;
  public static _mainRaceState:RaceState|null = null;

  constructor(map:RideMap, users:UserProvider, gameId:string) {
    this._map = map;
    this._userProvider = users;
    this._gameId = gameId;
    this._tmUnfinishedHuman = new Date().getTime();
    RaceState._mainRaceState = this;
  }
  public static getActiveRaceState() {
    return this._mainRaceState;
  }
  isOldNews():boolean {
    return this !== RaceState._mainRaceState;
  }
  stop() {
    this._stopped = true;
  }
  tick(tmNow:number) {
    if(this._stopped) {
      return;
    }
    if(typeof window !== 'undefined' && this.isOldNews()) {
      debugger;
      return;
    }
    const users = this._userProvider.getUsers(tmNow);
    users.forEach((user) => {
      
      user.physicsTick(tmNow, this._map, users);

      if(user.getUserType() & UserTypeFlags.Ai) {
        
      } else {
        // it's a human!
        //console.log("raceState tick on " + user.getId() + " " + user.getName(), user);
        if(user.isFinished()) {
          // they're finished
        } else {
          this._tmUnfinishedHuman = tmNow;
        }
      }
    });
  }
  getSecondsSinceLastNonFinishedHuman(tmNow:number):number {
    return Math.max(0, (tmNow - this._tmUnfinishedHuman) / 1000.0);
  }
  getGameId():string {
    return this._gameId;
  }
  getMap():RideMap {
    return this._map;
  }
  getLocalUser():UserInterface|null {
    const tmNow = new Date().getTime();
    const users = this._userProvider.getUsers(tmNow);
    const allLocal = users.filter((user) => {
      return user.getUserType() & UserTypeFlags.Local;
    });
    assert2(allLocal.length === 1);
    return allLocal[0];
  }

  isAllHumansFinished(tmNow:number):boolean {

    const humans = this._userProvider.getUsers(tmNow).filter((user) => !(user.getUserType() & UserTypeFlags.Ai));
    return humans.every((user) =>{
      return user.getDistance() >= this._map.getLength();
    });
  }
  isAllRacersFinished(tmNow:number):boolean {
    const users = this._userProvider.getUsers(tmNow);
    return users.every((user) => {
      return user.getDistance() >= this._map.getLength();
    });
  }
  isAnyHumansFinished(tmNow:number):boolean {

    const humans = this._userProvider.getUsers(tmNow).filter((user) => !(user.getUserType() & UserTypeFlags.Ai));
    return !!humans.find((user) =>{
      return user.getDistance() >= this._map.getLength();
    });
  }

  absorbPositionUpdate(tmNow:number, tmNowOnServer:number, msg:S2CPositionUpdate) {
    msg.clients.forEach((client) => {
      const user = this._userProvider.getUser(client.id);
      if(user) {
        user.absorbPositionUpdate(tmNow, tmNowOnServer, client);
      }

    })
  }
  absorbNameUpdate(tmNow:number, msg:S2CNameUpdate) {
    msg.ids.forEach((id, index) => {
      const user = this._userProvider.getUser(id);
      if(user) {
        user.absorbNameUpdate(tmNow, msg.names[index], msg.userTypes[index], msg.userHandicaps[index]);
      }
    })
  }

  getUserProvider():UserProvider {
    return this._userProvider;
  }
}